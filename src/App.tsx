import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, deleteAllData, exportAllData, importAllData, switchDatabase, saveWorkout, putRecord, removeRecord, checkpointWorkout, clearRecovery, flushWrites, timestamp, resumeIndex, remainingRest, requestPersistentStorage } from './storage'
import { exercises as builtInExercises, findExercise, programs as builtInPrograms } from './data'
import { detectNewPr, displayWeight, epley, inputToKg, roundWeight, workoutVolume } from './utils'
import { translate } from './i18n'
import { MuscleFigure } from './MuscleFigure'
import { AccountPanel, type Credentials } from './AccountPanel'
import { api, cacheAccount, cachedAccount } from './account'
import { localStatus, syncAccount, waitForSync, type SyncStatus } from './sync'
import type { Account, Exercise, Language, LoggedSet, Program, ProgramWorkout, Settings, Unit, WorkoutLog } from './types'
import './styles.css'

type View = 'today'|'programs'|'history'|'profile'|'workout'|'exercise'|'summary'|'custom'
const weekdays = ['SUN','MON','TUE','WED','THU','FRI','SAT']
const fiWeekdays = ['SU','MA','TI','KE','TO','PE','LA']
const defaultSettings: Settings = { id:'settings',language:'en',unit:'kg',onboardingDone:false,activeProgramId:'chest-arms',trainingDays:[1,3,5],autoRest:true }
const uid = () => crypto.randomUUID()
function formatDuration(seconds=0) { const m=Math.floor(seconds/60); const s=seconds%60; return `${m}:${String(s).padStart(2,'0')}` }
function workingSetCount(workout?: ProgramWorkout) { return workout?.exercises.reduce((n,e)=>n+e.sets,0) ?? 0 }

export default function App() {
  const [ready,setReady]=useState(false)
  const [settings,setSettings]=useState<Settings>(defaultSettings)
  const [programs,setPrograms]=useState<Program[]>(builtInPrograms)
  const [allExercises,setAllExercises]=useState<Exercise[]>(builtInExercises)
  const [logs,setLogs]=useState<WorkoutLog[]>([])
  const [view,setView]=useState<View>('today')
  const [activeLog,setActiveLog]=useState<WorkoutLog|null>(null)
  const activeRef=useRef<WorkoutLog|null>(null)
  const [selectedExercise,setSelectedExercise]=useState('bench-press')
  const [now,setNow]=useState(Date.now())
  const [summary,setSummary]=useState<WorkoutLog|null>(null)
  const [onboardingStep,setOnboardingStep]=useState(1)
  const [customDraft,setCustomDraft]=useState<Program|null>(null)
  const [account,setAccount]=useState<Account|null>(cachedAccount)
  const [syncStatus,setSyncStatus]=useState<SyncStatus>(localStatus)
  const [saveState,setSaveState]=useState('Saved on this device')
  const [error,setError]=useState('')
  const fileInput=useRef<HTMLInputElement>(null)
  const booted=useRef(false)
  const tr=(key:Parameters<typeof translate>[1])=>translate(settings.language,key)
  const activeExerciseIndex=activeLog ? resumeIndex(activeLog) : 0
  const restSeconds=remainingRest(activeLog?.progress?.restEndsAt,now)
  const restRunning=restSeconds>0

  const reload=useCallback(async (restore=false, force=false)=>{
    const activeAtStart=activeRef.current
    await flushWrites()
    const store=db
    const [savedSettings, savedPrograms, savedExercises, savedLogs]=await Promise.all([store.settings.get('settings'),store.programs.toArray(),store.exercises.toArray(),store.workouts.toArray()])
    if(store!==db)return
    setSettings(savedSettings ?? defaultSettings); setPrograms(savedPrograms); setAllExercises(savedExercises)
    const ordered=savedLogs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)); setLogs(ordered)
    const current=activeRef.current
    if(current!==activeAtStart&&!force)return
    const currentSync=current?await store.sync.get(`workouts:${current.id}`):undefined
    const found=current ? ordered.find(l=>l.id===current.id && !l.finishedAt) : restore ? ordered.find(l=>!l.finishedAt) : null
    if(found && (force || !current || currentSync?.dirty===0 || (found.updatedAt ?? found.startedAt)>=(current.updatedAt ?? current.startedAt))) {
      activeRef.current=found; setActiveLog(found); if(restore)setView('workout')
    } else if(force || (current && ordered.find(l=>l.id===current.id)?.finishedAt)) { activeRef.current=null; setActiveLog(null); setView('today') }
  },[])
  const showError=useCallback((err:unknown)=>setError(err instanceof Error?err.message:'The change could not be saved. Please try again.'),[])
  useEffect(()=>{
    if(booted.current)return
    booted.current=true
    switchDatabase(cachedAccount()?.id).then(()=>reload(true)).then(()=>setReady(true)).catch(showError)
  },[reload,showError])
  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(Date.now()),1000)
    const hidden=()=>{ if(activeRef.current)checkpointWorkout(activeRef.current); setNow(Date.now()) }
    document.addEventListener('visibilitychange',hidden); window.addEventListener('pagehide',hidden)
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',hidden)}
  },[])
  useEffect(()=>{
    const refresh=()=>{void reload().catch(showError)}
    const resolved=()=>{void reload(false,true).catch(showError)}
    const otherAccount=(event:StorageEvent)=>{if(event.key==='ironlog:account')window.location.reload()}
    window.addEventListener('ironlog-remote-change',refresh);window.addEventListener('ironlog-conflict-resolved',resolved);window.addEventListener('storage',otherAccount)
    return()=>{window.removeEventListener('ironlog-remote-change',refresh);window.removeEventListener('ironlog-conflict-resolved',resolved);window.removeEventListener('storage',otherAccount)}
  },[reload,showError])
  useEffect(()=>{
    if(!ready||!account)return
    let stopped=false
    const report=(status:SyncStatus)=>{if(!stopped)setSyncStatus(status)}
    const sync=()=>{if(!stopped&&document.visibilityState!=='hidden')void syncAccount(account,report)}
    let debounce:number|undefined
    const edited=()=>{window.clearTimeout(debounce);debounce=window.setTimeout(sync,800)}
    sync()
    const interval=window.setInterval(sync,15000)
    window.addEventListener('ironlog-local-change',edited);window.addEventListener('online',sync);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',sync)
    return()=>{stopped=true;window.clearTimeout(interval);window.clearTimeout(debounce);window.removeEventListener('ironlog-local-change',edited);window.removeEventListener('online',sync);window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',sync)}
  },[account,ready])

  const activeProgram=programs.find(p=>p.id===settings.activeProgramId) ?? programs[0]
  const todayIndex = useMemo(()=>{
    const pos=settings.trainingDays.indexOf(new Date().getDay()); return pos>=0 ? pos % Math.max(1,activeProgram?.workouts.length ?? 1) : -1
  },[settings.trainingDays,activeProgram])
  const nextWorkoutIndex = todayIndex>=0 ? todayIndex : (()=>{
    const recent=logs.find(l=>l.programId===settings.activeProgramId && l.finishedAt)
    if(!recent) return 0
    const idx=activeProgram?.workouts.findIndex(w=>w.id===recent.workoutId) ?? -1
    return (idx+1) % Math.max(1,activeProgram?.workouts.length ?? 1)
  })()
  const todayWorkout=activeProgram?.workouts[nextWorkoutIndex]
  const activeWorkout=activeLog?.plan ?? programs.find(p=>p.id===activeLog?.programId)?.workouts.find(w=>w.id===activeLog?.workoutId)
  async function persistSettings(patch:Partial<Settings>){ const next={...settings,...patch};setSettings(next);try{await putRecord('settings',next)}catch(e){showError(e)} }
  function resume(log:WorkoutLog){activeRef.current=log;setActiveLog(log);setNow(Date.now());setView('workout')}
  async function updateActive(next:WorkoutLog){
    const log={...next,updatedAt:timestamp()};activeRef.current=log;setActiveLog(log);setSaveState('Saving…')
    try{const result=await saveWorkout(log);if(activeRef.current?.updatedAt===log.updatedAt)setSaveState(result==='saved'?'Saved on this device':'Saved in recovery copy');return true}
    catch(e){setSaveState('Save failed');showError(e);return false}
  }
  function lastExerciseSets(id:string){for(const log of logs.filter(l=>l.finishedAt)){const ex=log.exercises.find(e=>e.exerciseId===id);if(ex?.sets.some(s=>s.completed))return ex.sets.filter(s=>s.completed)}return []}
  async function startWorkout(workout=todayWorkout){
    const existing=activeRef.current??logs.find(l=>!l.finishedAt)
    if(existing){resume(existing);return}
    if(!activeProgram||!workout||!workout.exercises.length)return
    void requestPersistentStorage()
    const log:WorkoutLog={id:uid(),programId:activeProgram.id,workoutId:workout.id,workoutName:workout.name,startedAt:timestamp(),plan:structuredClone(workout),progress:{exerciseIndex:0,restEndsAt:null},exercises:workout.exercises.map(pe=>{
      const prev=lastExerciseSets(pe.exerciseId).filter(s=>!s.warmup)
      return {exerciseId:pe.exerciseId,sets:Array.from({length:pe.sets},(_,i)=>({id:uid(),weightKg:prev[i]?.weightKg??prev[0]?.weightKg??0,reps:prev[i]?.reps??pe.repMin,completed:false}))}
    })}
    setView('workout');await updateActive(log)
  }
  async function updateSet(setIndex:number,patch:Partial<LoggedSet>){
    const current=activeRef.current;if(!current)return
    const next=structuredClone(current);const ex=next.exercises[resumeIndex(next)];if(!ex?.sets[setIndex])return
    ex.sets[setIndex]={...ex.sets[setIndex]!,...patch};await updateActive(next)
  }
  async function completeSet(setIndex:number){
    const current=activeRef.current;if(!current)return
    const next=structuredClone(current);const index=resumeIndex(next);const ex=next.exercises[index];const set=ex?.sets[setIndex];if(!ex||!set)return
    if(set.reps<1){setError('Enter at least one rep before completing a set.');return}
    set.completed=true
    const definition=next.plan?.exercises.find(e=>e.exerciseId===ex.exerciseId)??allExercises.find(e=>e.id===ex.exerciseId)
    next.progress={exerciseIndex:index,restEndsAt:settings.autoRest?Date.now()+(definition?.restSeconds??120)*1000:next.progress?.restEndsAt??null}
    setNow(Date.now());await updateActive(next)
  }
  async function changeProgress(patch:Partial<NonNullable<WorkoutLog['progress']>>){const log=activeRef.current;if(!log)return;setNow(Date.now());await updateActive({...log,progress:{exerciseIndex:resumeIndex(log),restEndsAt:log.progress?.restEndsAt??null,...patch}})}
  async function addSet(){const log=activeRef.current;if(!log)return;const next=structuredClone(log);const ex=next.exercises[resumeIndex(next)];if(!ex||ex.sets.length>=100)return;ex.sets.push({id:uid(),weightKg:0,reps:8,completed:false});await updateActive(next)}
  async function deleteSet(i:number){const log=activeRef.current;if(!log)return;const next=structuredClone(log);next.exercises[resumeIndex(next)]?.sets.splice(i,1);await updateActive(next)}
  async function addExerciseDuringWorkout(){
    const log=activeRef.current;if(!log||log.exercises.length>=100)return
    const name=prompt('Exercise name to add')?.trim();if(!name)return
    const found=allExercises.find(e=>e.name.toLowerCase()===name.toLowerCase())??allExercises.find(e=>e.name.toLowerCase().includes(name.toLowerCase()))
    if(!found){setError('Exercise not found.');return}
    const next=structuredClone(log);next.exercises.push({exerciseId:found.id,sets:[{id:uid(),weightKg:0,reps:found.repRange[0],completed:false}]});await updateActive(next)
  }
  async function finishWorkout(){
    const log=activeRef.current;if(!log)return
    if(log.exercises.some(e=>e.sets.some(s=>!s.completed))&&!confirm('Finish this workout? Only completed sets count toward your progress and rankings.'))return
    const finished={...log,finishedAt:timestamp(),durationSeconds:Math.max(1,Math.floor((Date.now()-Date.parse(log.startedAt))/1000)),progress:{exerciseIndex:resumeIndex(log),restEndsAt:null}}
    if(!await updateActive(finished))return
    setSummary(finished);activeRef.current=null;setActiveLog(null);await reload();setView('summary')
  }
  const exerciseHistory=(id:string)=>logs.filter(l=>l.finishedAt&&l.exercises.some(e=>e.exerciseId===id)).map(l=>({log:l,sets:l.exercises.find(e=>e.exerciseId===id)!.sets.filter(s=>s.completed)})).filter(x=>x.sets.length)
  async function chooseProgram(id:string){await persistSettings({activeProgramId:id});setView('today')}
  async function deleteProgram(id:string){if(!confirm('Delete this custom program?'))return;try{await removeRecord('programs',id);if(settings.activeProgramId===id)await persistSettings({activeProgramId:'chest-arms'});await reload()}catch(e){showError(e)}}
  function newCustomProgram(){setCustomDraft({id:`custom-${uid()}`,name:'My Program',description:'Custom training program',daysPerWeek:3,duration:'60 min',focus:'Custom',level:'Custom',custom:true,workouts:[{id:uid(),name:'Workout A',exercises:[]}]});setView('custom')}
  async function editProgram(p:Program){setCustomDraft(structuredClone(p));setView('custom')}
  async function saveCustom(){if(!customDraft)return;try{await putRecord('programs',customDraft);await reload();setView('programs')}catch(e){showError(e)}}
  async function exportData(){
    try{const text=await exportAllData(activeRef.current);if(JSON.parse(text).partial)setError("Recovery backup exported. Some older records were unavailable.");const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`ironlog-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){showError(e)}
  }
  async function importData(file?:File){if(!file)return;try{await importAllData(await file.text());activeRef.current=null;setActiveLog(null);await reload(true);setError('')}catch(e){showError(e)}finally{if(fileInput.current)fileInput.current.value=''}}
  async function wipe(){if(!confirm(account?'Delete this account’s training data? This will also sync deletions to your other devices.':'Delete all IRONLOG data on this device?'))return;try{await deleteAllData();activeRef.current=null;setActiveLog(null);await reload();setView('today')}catch(e){showError(e)}}
  async function changeIdentity(user:Account|null, guestBackup?:string|null, erasePrevious=false){
    setReady(false);setError('')
    const previous=db
    if(activeRef.current&&!erasePrevious)checkpointWorkout(activeRef.current,previous)
    activeRef.current=null;setActiveLog(null)
    try{
      if(erasePrevious){await flushWrites();clearRecovery(previous);await previous.delete()}
      cacheAccount(user);setAccount(user);setSyncStatus(localStatus)
      await switchDatabase(user?.id)
      if(guestBackup)await importAllData(guestBackup)
      await reload(true);setReady(true)
    }catch(e){showError(e);throw e}
  }
  async function authenticate(input:Credentials){
    await waitForSync();await flushWrites()
    const guestBackup=input.importGuest&&db.name==='ironlog'?await exportAllData(activeRef.current):null
    const result=await api<{user:Account}>(input.register?'/auth/register':'/auth/login','POST',{username:input.username,password:input.password,ranked:input.ranked})
    await changeIdentity(result.user,guestBackup);void requestPersistentStorage()
  }
  async function logout(){
    await waitForSync();await flushWrites();await api('/auth/logout','POST',{})
    await changeIdentity(null);setView('today')
  }
  async function deleteAccount(password:string){
    await waitForSync();await api('/account','DELETE',{password})
    await changeIdentity(null,null,true);setView('today')
  }
  const syncNow=async()=>{if(account)await syncAccount(account,setSyncStatus)}
  if(!ready)return <main className="loading"><div><strong>IRONLOG</strong>{error&&<><p role="alert">{error}</p><button onClick={()=>window.location.reload()}>Retry</button><button onClick={exportData}>Export recovery data</button></>}</div></main>
  if(!settings.onboardingDone&&!account)return <Onboarding step={onboardingStep} setStep={setOnboardingStep} settings={settings} programs={programs} onSettings={persistSettings} onDone={()=>persistSettings({onboardingDone:true})}/>
  const nav=<nav className="bottom-nav" aria-label="Main navigation">{(['today','programs','history','profile'] as View[]).map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}><span>{v==='today'?'01':v==='programs'?'02':v==='history'?'03':'04'}</span>{tr(v as 'today'|'programs'|'history'|'profile')}</button>)}</nav>
  const unfinished=logs.filter(l=>!l.finishedAt&&l.id!==activeLog?.id)
  return <div className="app-shell">
    <header className="brandbar"><button className="brand" onClick={()=>setView('today')} aria-label="IRONLOG home"><span className="brand-mark">I</span>IRONLOG</button><button className="status-chip" onClick={()=>setView('profile')}>{saveState==='Save failed'?'SAVE FAILED':account?syncStatus.state==='synced'?'ACCOUNT SYNCED':syncStatus.state==='syncing'?'SYNCING…':'DEVICE SAVED':'LOCAL / OFFLINE'}</button></header>
    {error&&<div className="save-warning" role="alert">{error}<button className="text-button" onClick={()=>setError('')}>Dismiss</button><button className="text-button" onClick={exportData}>Export data</button></div>}
    <main className="content">
      {view!=='workout'&&view!=='exercise'&&(activeLog||unfinished.length>0)&&<div className="resume-list">{[...(activeLog?[activeLog]:[]),...unfinished].map(log=><button className="resume-card" key={log.id} onClick={()=>resume(log)}><span>RESUME WORKOUT</span><strong>{log.workoutName}</strong><small>Exercise {resumeIndex(log)+1} of {log.exercises.length} · {log.exercises.reduce((n,e)=>n+e.sets.filter(s=>s.completed).length,0)} sets completed</small></button>)}</div>}
      {view==='today'&&<Today program={activeProgram} workout={todayWorkout} settings={settings} logs={logs} tr={tr} onStart={()=>startWorkout()} onExercise={id=>{setSelectedExercise(id);setView('exercise')}}/>}
      {view==='programs'&&<Programs programs={programs} activeId={settings.activeProgramId} tr={tr} choose={chooseProgram} newCustom={newCustomProgram} edit={editProgram} remove={deleteProgram}/>}
      {view==='history'&&<History logs={logs} exercises={allExercises} settings={settings} tr={tr} onExercise={id=>{setSelectedExercise(id);setView('exercise')}}/>}
      {view==='profile'&&<><Profile settings={settings} tr={tr} onSettings={persistSettings} onExport={exportData} onImport={()=>fileInput.current?.click()} onDelete={wipe}/><AccountPanel account={account} status={syncStatus} onAuthenticate={authenticate} onLogout={logout} onAccount={user=>{cacheAccount(user);setAccount(user)}} onSync={syncNow} onDelete={deleteAccount}/></>}
      {view==='workout'&&activeLog&&<><div className="workout-save-bar"><span role="status">{saveState}</span><button onClick={()=>{void reload();setView('today')}}>Save & exit</button><button onClick={finishWorkout}>Finish</button></div><WorkoutMode log={activeLog} workout={activeWorkout} exerciseIndex={activeExerciseIndex} exercises={allExercises} settings={settings} tr={tr} history={logs} onSet={updateSet} onDoneSet={completeSet} onAddSet={addSet} onDeleteSet={deleteSet} onExerciseIndex={index=>changeProgress({exerciseIndex:index})} onFinish={finishWorkout} onInfo={id=>{setSelectedExercise(id);setView('exercise')}} onAddExercise={addExerciseDuringWorkout} restSeconds={restSeconds} restRunning={restRunning} onRestAdd={()=>changeProgress({restEndsAt:Math.max(Date.now(),activeRef.current?.progress?.restEndsAt??0)+30000})} onRestSkip={()=>changeProgress({restEndsAt:null})}/></>}
      {view==='exercise'&&<ExerciseDetail exercise={allExercises.find(e=>e.id===selectedExercise)??allExercises[0]!} history={exerciseHistory(selectedExercise)} settings={settings} tr={tr} onBack={()=>setView(activeLog?'workout':'history')}/>}
      {view==='summary'&&summary&&<Summary log={summary} previous={logs.filter(l=>l.id!==summary.id&&l.finishedAt)} settings={settings} exercises={allExercises} tr={tr} onDone={()=>setView('today')}/>}
      {view==='custom'&&customDraft&&<CustomProgram draft={customDraft} setDraft={setCustomDraft} exercises={allExercises} tr={tr} onSave={saveCustom} onCancel={()=>setView('programs')}/>}
    </main>
    {!['workout','exercise','summary','custom'].includes(view)&&nav}
    <input ref={fileInput} type="file" accept="application/json" hidden onChange={e=>importData(e.target.files?.[0])}/>
  </div>
}

function Onboarding({step,setStep,settings,programs,onSettings,onDone}:{step:number;setStep:(n:number)=>void;settings:Settings;programs:Program[];onSettings:(p:Partial<Settings>)=>Promise<void>;onDone:()=>Promise<void>}){
  const tr=(k:Parameters<typeof translate>[1])=>translate(settings.language,k)
  const featured=programs.find(p=>p.featured)??programs[0]!
  if(step===1)return <main className="onboarding poster"><div className="plate-logo">I</div><p className="eyebrow">PHYSICAL TRAINING RECORD / 01</p><h1>IRONLOG</h1><h2>BUILD.<br/>LOG.<br/><span>PROGRESS.</span></h2><button className="primary massive" onClick={()=>setStep(2)}>{tr('getStarted')}</button></main>
  if(step===2)return <main className="onboarding"><p className="eyebrow">PROGRAM / 02</p><h1>{tr('choose')}</h1><article className="program-card featured"><div className="stamp">{tr('recommended')}</div><h2>{featured.name}</h2><p>{featured.daysPerWeek} DAYS / WEEK · {featured.duration}</p><p>{featured.description}</p><button className="primary" onClick={()=>setStep(3)}>SELECT</button></article><button className="text-button" onClick={()=>onSettings({onboardingDone:true})}>Use another program later</button></main>
  return <main className="onboarding"><p className="eyebrow">SCHEDULE / 03</p><h1>{tr('trainingDays')}</h1><DayPicker value={settings.trainingDays} onChange={(days)=>onSettings({trainingDays:days})} lang={settings.language}/><p className="muted">Choose any three days. Missed workouts can be done later.</p><button className="primary massive" onClick={onDone}>{tr('startTraining')}</button></main>
}

function DayPicker({value,onChange,lang}:{value:number[];onChange:(n:number[])=>void;lang:Language}){
  const labels=lang==='fi'?fiWeekdays:weekdays.map(x=>x.slice(0,2))
  return <div className="day-picker">{[1,2,3,4,5,6,0].map(day=><button key={day} className={value.includes(day)?'selected':''} onClick={()=>{const has=value.includes(day); const next=has?value.filter(d=>d!==day):[...value,day]; if(next.length>0&&next.length<=4)onChange(next)}} aria-pressed={value.includes(day)}>{labels[day]}</button>)}</div>
}

function Today({program,workout,settings,logs,tr,onStart,onExercise}:{program?:Program;workout?:ProgramWorkout;settings:Settings;logs:WorkoutLog[];tr:(k:Parameters<typeof translate>[1])=>string;onStart:()=>void;onExercise:(id:string)=>void}){
  if(!program||!workout)return null
  const date=new Intl.DateTimeFormat(settings.language==='fi'?'fi-FI':'en-GB',{weekday:'long',day:'numeric',month:'long'}).format(new Date())
  const last=logs.find(l=>l.finishedAt)
  const bench=last?.exercises.find(e=>e.exerciseId==='bench-press')?.sets.filter(s=>s.completed).at(-1)
  return <section className="page today-page"><p className="eyebrow">{date.toUpperCase()}</p><h1>{tr('today').toUpperCase()}</h1><article className="session-sheet"><div className="session-number">SESSION {String((program.workouts.findIndex(w=>w.id===workout.id)+1)).padStart(2,'0')}</div><h2>{workout.name.toUpperCase()}</h2><p>{workout.exercises.length} {tr('exercises')} · {workingSetCount(workout)} {tr('workingSets')} · {program.duration}</p><div className="exercise-stripes">{workout.exercises.map((pe,i)=>{const ex=findExercise(pe.exerciseId);return <button key={pe.exerciseId} onClick={()=>onExercise(pe.exerciseId)}><span>{String(i+1).padStart(2,'0')}</span>{ex?.name}<b>{pe.sets}×{pe.repMin}–{pe.repMax}</b></button>})}</div><button className="primary massive" onClick={onStart}>{tr('startWorkout').toUpperCase()}</button></article>{last&&<div className="last-block"><p className="eyebrow">{tr('lastSession').toUpperCase()}</p><strong>{last.workoutName}</strong>{bench&&<p>Bench Press · {roundWeight(displayWeight(bench.weightKg,settings.unit))} {settings.unit} × {bench.reps}</p>}</div>}</section>
}

function Programs({programs,activeId,tr,choose,newCustom,edit,remove}:{programs:Program[];activeId:string;tr:(k:Parameters<typeof translate>[1])=>string;choose:(id:string)=>void;newCustom:()=>void;edit:(p:Program)=>void;remove:(id:string)=>void}){
  return <section className="page"><div className="page-title"><div><p className="eyebrow">TRAINING SYSTEM</p><h1>{tr('programs').toUpperCase()}</h1></div><button className="square-button" onClick={newCustom}>＋</button></div><div className="program-grid">{programs.slice().sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)).map(p=><article key={p.id} className={`program-card ${p.featured?'featured':''} ${p.id===activeId?'active-program':''}`}>{p.featured&&<div className="stamp">FEATURED</div>}<p className="eyebrow">{p.daysPerWeek} DAYS · {p.duration}</p><h2>{p.name}</h2><p>{p.description}</p><div className="card-meta"><span>{p.focus}</span><span>{p.level}</span></div><div className="card-actions"><button className="primary" disabled={p.id===activeId} onClick={()=>choose(p.id)}>{p.id===activeId?'ACTIVE':tr('selectProgram')}</button>{p.custom&&<><button onClick={()=>edit(p)}>EDIT</button><button onClick={()=>remove(p.id)}>DELETE</button></>}</div></article>)}</div></section>
}

function History({logs,exercises,settings,tr,onExercise}:{logs:WorkoutLog[];exercises:Exercise[];settings:Settings;tr:(k:Parameters<typeof translate>[1])=>string;onExercise:(id:string)=>void}){
  const completed=logs.filter(l=>l.finishedAt)
  const exerciseBest=new Map<string,{set:LoggedSet;est:number}>()
  completed.forEach(l=>l.exercises.forEach(e=>e.sets.filter(s=>s.completed&&!s.warmup).forEach(s=>{const est=epley(s.weightKg,s.reps);if(est>(exerciseBest.get(e.exerciseId)?.est??0))exerciseBest.set(e.exerciseId,{set:s,est})})))
  return <section className="page"><p className="eyebrow">PROGRESS RECORD</p><h1>{tr('history').toUpperCase()}</h1><div className="stat-row"><div><strong>{completed.length}</strong><span>WORKOUTS</span></div><div><strong>{Math.round(completed.reduce((n,l)=>n+workoutVolume(l),0)).toLocaleString()}</strong><span>KG VOLUME</span></div><div><strong>{exerciseBest.size}</strong><span>EXERCISES</span></div></div><h2 className="section-title">EXERCISE RECORDS</h2><div className="record-list">{[...exerciseBest.entries()].sort((a,b)=>b[1].est-a[1].est).slice(0,12).map(([id,best])=><button key={id} onClick={()=>onExercise(id)}><span><b>{exercises.find(e=>e.id===id)?.name}</b><small>{tr('estimated1rm')} {roundWeight(displayWeight(best.est,settings.unit))} {settings.unit}</small></span><strong>{roundWeight(displayWeight(best.set.weightKg,settings.unit))} × {best.set.reps}</strong></button>)}</div>{completed.length===0&&<div className="empty-state"><h2>NO TRAINING HISTORY YET</h2><p>Finish your first workout and your strength progress will appear here.</p></div>}</section>
}

function Profile({settings,tr,onSettings,onExport,onImport,onDelete}:{settings:Settings;tr:(k:Parameters<typeof translate>[1])=>string;onSettings:(p:Partial<Settings>)=>Promise<void>;onExport:()=>void;onImport:()=>void;onDelete:()=>void}){
  return <section className="page"><p className="eyebrow">DEVICE SETTINGS</p><h1>{tr('profile').toUpperCase()}</h1><div className="settings-list"><label><span>{tr('language')}</span><select value={settings.language} onChange={e=>onSettings({language:e.target.value as Language})}><option value="en">English</option><option value="fi">Suomi</option></select></label><label><span>{tr('units')}</span><select value={settings.unit} onChange={e=>onSettings({unit:e.target.value as Unit})}><option value="kg">kg</option><option value="lb">lb</option></select></label><label><span>{tr('autoRest')}</span><input type="checkbox" checked={settings.autoRest} onChange={e=>onSettings({autoRest:e.target.checked})}/></label><div><span>{tr('trainingDays')}</span><DayPicker value={settings.trainingDays} onChange={(days)=>onSettings({trainingDays:days})} lang={settings.language}/></div></div><h2 className="section-title">{tr('data').toUpperCase()}</h2><div className="data-actions"><button onClick={onExport}>{tr('export')}</button><button onClick={onImport}>{tr('import')}</button><button className="danger" onClick={onDelete}>{tr('delete')}</button></div><p className="privacy-note">Guest data stays on this device. Signed-in accounts sync to your server. Export a backup before clearing browser data.</p></section>
}

function WorkoutMode({log,workout,exerciseIndex,exercises,settings,tr,history,onSet,onDoneSet,onAddSet,onDeleteSet,onExerciseIndex,onFinish,onInfo,onAddExercise,restSeconds,restRunning,onRestAdd,onRestSkip}:{log:WorkoutLog;workout?:ProgramWorkout;exerciseIndex:number;exercises:Exercise[];settings:Settings;tr:(k:Parameters<typeof translate>[1])=>string;history:WorkoutLog[];onSet:(i:number,p:Partial<LoggedSet>)=>void;onDoneSet:(i:number)=>void;onAddSet:()=>void;onDeleteSet:(i:number)=>void;onExerciseIndex:(i:number)=>void;onFinish:()=>void;onInfo:(id:string)=>void;onAddExercise:()=>void;restSeconds:number;restRunning:boolean;onRestAdd:()=>void;onRestSkip:()=>void}){
  const exLog=log.exercises[exerciseIndex]; if(!exLog)return null
  const ex=exercises.find(e=>e.id===exLog.exerciseId); if(!ex)return <section className="page"><p>Exercise details are unavailable. Your sets are saved.</p><button onClick={onFinish}>Finish workout</button></section>; const pe=workout?.exercises.find(p=>p.exerciseId===ex.id)
  const prev=history.find(l=>l.id!==log.id&&l.finishedAt&&l.exercises.some(e=>e.exerciseId===ex.id))?.exercises.find(e=>e.exerciseId===ex.id)?.sets.filter(s=>s.completed) ?? []
  return <section className="workout-mode"><div className="workout-head"><div><p>{log.workoutName.toUpperCase()}</p><strong>{formatDuration(Math.floor((Date.now()-new Date(log.startedAt).getTime())/1000))}</strong></div><span>{exerciseIndex+1} / {log.exercises.length}</span></div><div className="progress-line"><i style={{width:`${((exerciseIndex+1)/log.exercises.length)*100}%`}}/></div><article className="current-exercise"><div className="exercise-top"><div><p className="eyebrow">CURRENT EXERCISE</p><h1>{ex.name.toUpperCase()}</h1><p>{ex.primary.join(' · ')}{ex.secondary.length?` · ${ex.secondary.join(' · ')}`:''}</p></div><MuscleFigure primary={ex.primary} secondary={ex.secondary} compact/></div><div className="target-line"><strong>{pe?.sets ?? exLog.sets.length} × {pe?.repMin ?? ex.repRange[0]}–{pe?.repMax ?? ex.repRange[1]}</strong><span>{Math.round((pe?.restSeconds??ex.restSeconds)/60*10)/10} MIN REST</span></div><div className="set-header"><span>{tr('set')}</span><span>{tr('previous')}</span><span>{settings.unit.toUpperCase()}</span><span>{tr('reps')}</span><span>{tr('done')}</span></div><div className="set-list">{exLog.sets.map((s,i)=><div key={s.id} className={`set-row ${s.completed?'complete':''}`}><button className="warmup-toggle" onClick={()=>onSet(i,{warmup:!s.warmup})} aria-label={`Mark set ${i+1} warm-up`}>{s.warmup?'W':i+1}</button><span className="previous-value">{prev[i]?`${roundWeight(displayWeight(prev[i]!.weightKg,settings.unit))}×${prev[i]!.reps}`:'—'}</span><input aria-label={`Set ${i+1} weight`} inputMode="decimal" type="text" maxLength={16} value={s.inputUnit===settings.unit&&s.weightInput!==undefined?s.weightInput:s.weightKg?roundWeight(displayWeight(s.weightKg,settings.unit)):''} onChange={e=>{const raw=e.target.value;if(!/^\d*([.,]\d*)?$/.test(raw))return;const n=Number(raw.replace(',','.'));if(Number.isFinite(n)&&inputToKg(n,settings.unit)<=1000)onSet(i,{weightKg:inputToKg(n,settings.unit),weightInput:raw,inputUnit:settings.unit})}}/><input aria-label={`Set ${i+1} reps`} inputMode="numeric" type="text" maxLength={4} value={s.repsInput??(s.reps||'')} onChange={e=>{const raw=e.target.value;if(!/^\d*$/.test(raw)||Number(raw)>1000)return;onSet(i,{reps:Number(raw),repsInput:raw,...(!Number(raw)?{completed:false}:{})})}}/><button className="done-set" onClick={()=>s.completed?onSet(i,{completed:false}):onDoneSet(i)} aria-pressed={s.completed}>✓</button><button className="delete-set" aria-label={`Delete set ${i+1}`} onClick={()=>onDeleteSet(i)}>×</button></div>)}</div><div className="workout-tools"><button onClick={onAddSet}>+ SET</button><button onClick={()=>onInfo(ex.id)}>{tr('instructions')}</button><button onClick={onAddExercise}>+ EXERCISE</button></div><div className="exercise-nav"><button disabled={exerciseIndex===0} onClick={()=>onExerciseIndex(exerciseIndex-1)}>← PREV</button>{exerciseIndex<log.exercises.length-1?<button className="primary" onClick={()=>onExerciseIndex(exerciseIndex+1)}>NEXT →</button>:<button className="primary" onClick={onFinish}>{tr('finish').toUpperCase()}</button>}</div></article>{restRunning&&<div className="rest-bar" aria-live="polite"><div><small>{tr('rest')}</small><strong>{formatDuration(restSeconds)}</strong></div><button onClick={onRestAdd}>+30 SEC</button><button onClick={onRestSkip}>{tr('skip')}</button></div>}</section>
}

function ExerciseDetail({exercise,history,settings,tr,onBack}:{exercise:Exercise;history:{log:WorkoutLog;sets:LoggedSet[]}[];settings:Settings;tr:(k:Parameters<typeof translate>[1])=>string;onBack:()=>void}){
  const allSets=history.flatMap(x=>x.sets).filter(s=>!s.warmup)
  const best=allSets.sort((a,b)=>epley(b.weightKg,b.reps)-epley(a.weightKg,a.reps))[0]
  const points=history.slice().reverse().map(x=>({date:new Date(x.log.startedAt).toLocaleDateString(),value:Math.max(...x.sets.map(s=>epley(s.weightKg,s.reps))) }))
  return <section className="page exercise-detail"><button className="back-button" onClick={onBack}>← BACK</button><p className="eyebrow">EXERCISE RECORD</p><h1>{exercise.name.toUpperCase()}</h1><p className="muscle-copy">{exercise.primary.join(' · ')}</p><div className="exercise-detail-grid"><MuscleFigure primary={exercise.primary} secondary={exercise.secondary}/><div className="metric-stack"><div><small>{tr('best').toUpperCase()}</small><strong>{best?`${roundWeight(displayWeight(best.weightKg,settings.unit))} ${settings.unit} × ${best.reps}`:'—'}</strong></div><div><small>{tr('estimated1rm').toUpperCase()}</small><strong>{best?`${roundWeight(displayWeight(epley(best.weightKg,best.reps),settings.unit))} ${settings.unit}`:'—'}</strong></div><div><small>EQUIPMENT</small><strong>{exercise.equipment}</strong></div></div></div>{points.length>0&&<div className="mini-chart" aria-label={`Estimated 1RM history: ${points.map(p=>`${p.date} ${roundWeight(p.value)} kg`).join(', ')}`}><div className="chart-bars">{points.slice(-12).map((p,i)=>{const max=Math.max(...points.map(x=>x.value));return <i key={i} title={`${p.date}: ${roundWeight(p.value)} kg`} style={{height:`${Math.max(8,p.value/max*100)}%`}}/>})}</div><small>{tr('estimated1rm')} · last {Math.min(points.length,12)} sessions</small></div>}<div className="instruction-block"><h2>{tr('how').toUpperCase()}</h2><ol>{exercise.instructions.map((x,i)=><li key={i}>{x}</li>)}</ol><h2>{tr('mistakes').toUpperCase()}</h2><ul>{exercise.mistakes.map((x,i)=><li key={i}>{x}</li>)}</ul></div></section>
}

function Summary({log,previous,settings,exercises,tr,onDone}:{log:WorkoutLog;previous:WorkoutLog[];settings:Settings;exercises:Exercise[];tr:(k:Parameters<typeof translate>[1])=>string;onDone:()=>void}){
  const prs=log.exercises.map(e=>({id:e.exerciseId,...detectNewPr(previous,e.exerciseId,e.sets)})).filter(x=>x.isPr)
  return <section className="summary-page"><p className="eyebrow">SESSION COMPLETE</p><h1>{tr('complete').toUpperCase()}</h1><div className="summary-metrics"><div><strong>{Math.round((log.durationSeconds??0)/60)}</strong><span>MIN</span></div><div><strong>{log.exercises.reduce((n,e)=>n+e.sets.filter(s=>s.completed&&!s.warmup).length,0)}</strong><span>SETS</span></div><div><strong>{Math.round(workoutVolume(log)).toLocaleString()}</strong><span>KG</span></div></div>{prs.length>0&&<div className="pr-card"><small>NEW ESTIMATED 1RM</small><h2>{exercises.find(e=>e.id===prs[0]!.id)?.name}</h2><strong>{roundWeight(displayWeight(prs[0]!.newBest,settings.unit))} {settings.unit}</strong></div>}<div className="summary-exercises">{log.exercises.map(e=><div key={e.exerciseId}><b>{exercises.find(x=>x.id===e.exerciseId)?.name}</b><span>{e.sets.filter(s=>s.completed).map(s=>`${roundWeight(displayWeight(s.weightKg,settings.unit))}×${s.reps}`).join(' · ') || 'Skipped'}</span></div>)}</div><button className="primary massive" onClick={onDone}>{tr('done').toUpperCase()}</button></section>
}

function CustomProgram({draft,setDraft,exercises,tr,onSave,onCancel}:{draft:Program;setDraft:(p:Program)=>void;exercises:Exercise[];tr:(k:Parameters<typeof translate>[1])=>string;onSave:()=>void;onCancel:()=>void}){
  const workout=draft.workouts[0]!
  function updateWorkout(next:ProgramWorkout){ setDraft({...draft,workouts:[next,...draft.workouts.slice(1)]}) }
  function addExercise(id:string){ if(!id)return; const ex=exercises.find(e=>e.id===id)!; updateWorkout({...workout,exercises:[...workout.exercises,{exerciseId:id,sets:3,repMin:ex.repRange[0],repMax:ex.repRange[1],restSeconds:ex.restSeconds}]}) }
  return <section className="page custom-page"><button className="back-button" onClick={onCancel}>← {tr('cancel').toUpperCase()}</button><p className="eyebrow">CUSTOM PROGRAM</p><h1>{tr('createProgram').toUpperCase()}</h1><label className="field-label">PROGRAM NAME<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label className="field-label">WORKOUT NAME<input value={workout.name} onChange={e=>updateWorkout({...workout,name:e.target.value})}/></label><div className="custom-exercises">{workout.exercises.map((pe,i)=>{const ex=exercises.find(e=>e.id===pe.exerciseId)!;return <div key={`${pe.exerciseId}-${i}`}><b>{ex.name}</b><label>SETS<input type="number" value={pe.sets} onChange={e=>{const arr=[...workout.exercises];arr[i]={...pe,sets:Number(e.target.value)};updateWorkout({...workout,exercises:arr})}}/></label><label>MIN<input type="number" value={pe.repMin} onChange={e=>{const arr=[...workout.exercises];arr[i]={...pe,repMin:Number(e.target.value)};updateWorkout({...workout,exercises:arr})}}/></label><label>MAX<input type="number" value={pe.repMax} onChange={e=>{const arr=[...workout.exercises];arr[i]={...pe,repMax:Number(e.target.value)};updateWorkout({...workout,exercises:arr})}}/></label><button aria-label={`Remove ${ex.name}`} onClick={()=>updateWorkout({...workout,exercises:workout.exercises.filter((_,n)=>n!==i)})}>×</button></div>})}</div><label className="field-label">{tr('addExercise').toUpperCase()}<select defaultValue="" onChange={e=>{addExercise(e.target.value);e.target.value='' }}><option value="" disabled>Choose exercise</option>{exercises.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><div className="custom-actions"><button onClick={onCancel}>{tr('cancel')}</button><button className="primary" disabled={!draft.name.trim()||workout.exercises.length===0} onClick={onSave}>{tr('save')}</button></div></section>
}
