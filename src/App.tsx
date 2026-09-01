import { useEffect, useMemo, useRef, useState } from 'react'
import { db, deleteAllData, exportAllData, importAllData, seedDatabase } from './storage'
import { exercises as builtInExercises, findExercise, programs as builtInPrograms } from './data'
import { detectNewPr, displayWeight, epley, inputToKg, roundWeight, workoutVolume } from './utils'
import { translate } from './i18n'
import { MuscleFigure } from './MuscleFigure'
import type { Exercise, Language, LoggedSet, Program, ProgramWorkout, Settings, Unit, WorkoutLog } from './types'
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
  const [activeExerciseIndex,setActiveExerciseIndex]=useState(0)
  const [selectedExercise,setSelectedExercise]=useState<string>('bench-press')
  const [restSeconds,setRestSeconds]=useState(0)
  const [restRunning,setRestRunning]=useState(false)
  const [summary,setSummary]=useState<WorkoutLog|null>(null)
  const [onboardingStep,setOnboardingStep]=useState(1)
  const [customDraft,setCustomDraft]=useState<Program|null>(null)
  const fileInput=useRef<HTMLInputElement>(null)

  const tr=(key:Parameters<typeof translate>[1])=>translate(settings.language,key)

  async function reload() {
    setSettings((await db.settings.get('settings')) ?? defaultSettings)
    setPrograms(await db.programs.toArray())
    setAllExercises(await db.exercises.toArray())
    setLogs((await db.workouts.toArray()).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)))
  }

  useEffect(()=>{ seedDatabase().then(reload).then(()=>setReady(true)) },[])
  useEffect(()=>{
    if (!restRunning || restSeconds<=0) return
    const timer=window.setInterval(()=>setRestSeconds(v=>{
      if(v<=1){ setRestRunning(false); if('vibrate' in navigator) navigator.vibrate?.(200); return 0 }
      return v-1
    }),1000)
    return()=>window.clearInterval(timer)
  },[restRunning,restSeconds])

  const activeProgram=programs.find(p=>p.id===settings.activeProgramId) ?? programs[0]
  const todayIndex = useMemo(()=>{
    const day=new Date().getDay(); const pos=settings.trainingDays.indexOf(day); return pos>=0 ? pos % Math.max(1,activeProgram?.workouts.length ?? 1) : -1
  },[settings.trainingDays,activeProgram])
  const nextWorkoutIndex = todayIndex>=0 ? todayIndex : (()=>{
    const recent=logs.find(l=>l.programId===settings.activeProgramId && l.finishedAt)
    if(!recent) return 0
    const idx=activeProgram?.workouts.findIndex(w=>w.id===recent.workoutId) ?? -1
    return (idx+1) % Math.max(1,activeProgram?.workouts.length ?? 1)
  })()
  const todayWorkout=activeProgram?.workouts[nextWorkoutIndex]

  async function persistSettings(patch:Partial<Settings>){ const next={...settings,...patch}; setSettings(next); await db.settings.put(next) }

  function lastExerciseSets(exerciseId:string) {
    for(const log of logs){ const ex=log.exercises.find(e=>e.exerciseId===exerciseId); if(ex?.sets.some(s=>s.completed)) return ex.sets.filter(s=>s.completed) }
    return []
  }

  async function startWorkout(workout=todayWorkout){
    if(!activeProgram||!workout)return
    const log:WorkoutLog={ id:uid(),programId:activeProgram.id,workoutId:workout.id,workoutName:workout.name,startedAt:new Date().toISOString(),exercises:workout.exercises.map(pe=>{
      const prev=lastExerciseSets(pe.exerciseId).filter(s=>!s.warmup)
      return {exerciseId:pe.exerciseId,sets:Array.from({length:pe.sets},(_,i)=>({id:uid(),weightKg:prev[i]?.weightKg ?? prev[0]?.weightKg ?? 0,reps:prev[i]?.reps ?? pe.repMin,completed:false}))}
    }) }
    await db.workouts.put(log); setActiveLog(log); setActiveExerciseIndex(0); setView('workout')
  }

  async function updateActive(next:WorkoutLog){ setActiveLog(next); await db.workouts.put(next) }
  async function updateSet(setIndex:number,patch:Partial<LoggedSet>){
    if(!activeLog)return
    const next=structuredClone(activeLog); const ex=next.exercises[activeExerciseIndex]; if(!ex)return
    ex.sets[setIndex]={...ex.sets[setIndex]!,...patch}; await updateActive(next)
  }
  async function completeSet(setIndex:number){
    if(!activeLog||!todayWorkout)return
    const exDef=todayWorkout.exercises[activeExerciseIndex]; if(!exDef)return
    await updateSet(setIndex,{completed:true})
    if(settings.autoRest){ setRestSeconds(exDef.restSeconds); setRestRunning(true) }
  }
  async function addSet(){ if(!activeLog)return; const next=structuredClone(activeLog); next.exercises[activeExerciseIndex]?.sets.push({id:uid(),weightKg:0,reps:8,completed:false}); await updateActive(next) }
  async function deleteSet(i:number){ if(!activeLog)return; const next=structuredClone(activeLog); next.exercises[activeExerciseIndex]?.sets.splice(i,1); await updateActive(next) }
  async function addExerciseDuringWorkout(){
    if(!activeLog)return
    const id=prompt('Exercise name to add')
    const found=allExercises.find(e=>e.name.toLowerCase()===id?.toLowerCase()) ?? allExercises.find(e=>e.name.toLowerCase().includes(id?.toLowerCase() ?? ''))
    if(!found)return
    const next=structuredClone(activeLog); next.exercises.push({exerciseId:found.id,sets:[{id:uid(),weightKg:0,reps:found.repRange[0],completed:false}]}); await updateActive(next)
  }
  async function finishWorkout(){
    if(!activeLog)return
    const finished={...activeLog,finishedAt:new Date().toISOString(),durationSeconds:Math.max(1,Math.floor((Date.now()-new Date(activeLog.startedAt).getTime())/1000))}
    await db.workouts.put(finished); setSummary(finished); setActiveLog(null); setRestRunning(false); await reload(); setView('summary')
  }

  const exerciseHistory=(id:string)=>logs.filter(l=>l.finishedAt && l.exercises.some(e=>e.exerciseId===id)).map(l=>({log:l,sets:l.exercises.find(e=>e.exerciseId===id)!.sets.filter(s=>s.completed)})).filter(x=>x.sets.length)

  async function chooseProgram(id:string){ await persistSettings({activeProgramId:id}); setView('today') }
  async function deleteProgram(id:string){ if(!confirm('Delete this custom program?'))return; await db.programs.delete(id); if(settings.activeProgramId===id) await persistSettings({activeProgramId:'chest-arms'}); await reload() }
  function newCustomProgram(){ setCustomDraft({id:`custom-${uid()}`,name:'My Program',description:'Custom training program',daysPerWeek:3,duration:'60 min',focus:'Custom',level:'Custom',custom:true,workouts:[{id:uid(),name:'Workout A',exercises:[]}]}); setView('custom') }
  async function editProgram(p:Program){ setCustomDraft(structuredClone(p)); setView('custom') }
  async function saveCustom(){ if(!customDraft)return; await db.programs.put(customDraft); await reload(); setView('programs') }

  async function exportData(){
    const text=await exportAllData(); const url=URL.createObjectURL(new Blob([text],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download=`ironlog-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url)
  }
  async function importData(file?:File){ if(!file)return; await importAllData(await file.text()); await reload(); alert('IRONLOG data imported.') }
  async function wipe(){ if(!confirm('Delete all IRONLOG data on this device?'))return; await deleteAllData(); await reload(); setView('today') }

  if(!ready) return <main className="loading"><strong>IRONLOG</strong></main>
  if(!settings.onboardingDone) return <Onboarding step={onboardingStep} setStep={setOnboardingStep} settings={settings} programs={programs} onSettings={persistSettings} onDone={()=>persistSettings({onboardingDone:true})}/>

  const nav=<nav className="bottom-nav" aria-label="Main navigation">
    {(['today','programs','history','profile'] as View[]).map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}><span>{v==='today'?'01':v==='programs'?'02':v==='history'?'03':'04'}</span>{tr(v as 'today'|'programs'|'history'|'profile')}</button>)}
  </nav>

  return <div className="app-shell">
    <header className="brandbar"><button className="brand" onClick={()=>setView('today')} aria-label="IRONLOG home"><span className="brand-mark">I</span>IRONLOG</button><span className="status-chip">LOCAL / OFFLINE</span></header>
    <main className="content">
      {view==='today' && <Today program={activeProgram} workout={todayWorkout} settings={settings} logs={logs} tr={tr} onStart={()=>startWorkout()} onExercise={(id)=>{setSelectedExercise(id);setView('exercise')}}/>}
      {view==='programs' && <Programs programs={programs} activeId={settings.activeProgramId} tr={tr} choose={chooseProgram} newCustom={newCustomProgram} edit={editProgram} remove={deleteProgram}/>} 
      {view==='history' && <History logs={logs} exercises={allExercises} settings={settings} tr={tr} onExercise={(id)=>{setSelectedExercise(id);setView('exercise')}}/>}
      {view==='profile' && <Profile settings={settings} tr={tr} onSettings={persistSettings} onExport={exportData} onImport={()=>fileInput.current?.click()} onDelete={wipe}/>} 
      {view==='workout' && activeLog && <WorkoutMode log={activeLog} workout={todayWorkout} exerciseIndex={activeExerciseIndex} exercises={allExercises} settings={settings} tr={tr} history={logs} onSet={updateSet} onDoneSet={completeSet} onAddSet={addSet} onDeleteSet={deleteSet} onExerciseIndex={setActiveExerciseIndex} onFinish={finishWorkout} onInfo={(id)=>{setSelectedExercise(id);setView('exercise')}} onAddExercise={addExerciseDuringWorkout} restSeconds={restSeconds} restRunning={restRunning} onRestAdd={()=>setRestSeconds(v=>v+30)} onRestSkip={()=>{setRestSeconds(0);setRestRunning(false)}}/>}
      {view==='exercise' && <ExerciseDetail exercise={allExercises.find(e=>e.id===selectedExercise) ?? allExercises[0]!} history={exerciseHistory(selectedExercise)} settings={settings} tr={tr} onBack={()=>setView(activeLog?'workout':'history')}/>} 
      {view==='summary' && summary && <Summary log={summary} previous={logs.filter(l=>l.id!==summary.id)} settings={settings} exercises={allExercises} tr={tr} onDone={()=>setView('today')}/>} 
      {view==='custom' && customDraft && <CustomProgram draft={customDraft} setDraft={setCustomDraft} exercises={allExercises} tr={tr} onSave={saveCustom} onCancel={()=>setView('programs')}/>} 
    </main>
    {!['workout','exercise','summary','custom'].includes(view) && nav}
    <input ref={fileInput} type="file" accept="application/json" hidden onChange={e=>importData(e.target.files?.[0])}/>
  </div>
}

function Onboarding({step,setStep,settings,programs,onSettings,onDone}:{step:number;setStep:(n:number)=>void;settings:Settings;programs:Program[];onSettings:(p:Partial<Settings>)=>Promise<void>;onDone:()=>Promise<void>}){
  const tr=(k:Parameters<typeof translate>[1])=>translate(settings.language,k)
  const featured=programs.find(p=>p.featured)!
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
  return <section className="page"><div className="page-title"><div><p className="eyebrow">TRAINING SYSTEM</p><h1>{tr('programs').toUpperCase()}</h1></div><button className="square-button" onClick={newCustom}>＋</button></div><div className="program-grid">{programs.sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)).map(p=><article key={p.id} className={`program-card ${p.featured?'featured':''} ${p.id===activeId?'active-program':''}`}>{p.featured&&<div className="stamp">FEATURED</div>}<p className="eyebrow">{p.daysPerWeek} DAYS · {p.duration}</p><h2>{p.name}</h2><p>{p.description}</p><div className="card-meta"><span>{p.focus}</span><span>{p.level}</span></div><div className="card-actions"><button className="primary" disabled={p.id===activeId} onClick={()=>choose(p.id)}>{p.id===activeId?'ACTIVE':tr('selectProgram')}</button>{p.custom&&<><button onClick={()=>edit(p)}>EDIT</button><button onClick={()=>remove(p.id)}>DELETE</button></>}</div></article>)}</div></section>
}

function History({logs,exercises,settings,tr,onExercise}:{logs:WorkoutLog[];exercises:Exercise[];settings:Settings;tr:(k:Parameters<typeof translate>[1])=>string;onExercise:(id:string)=>void}){
  const completed=logs.filter(l=>l.finishedAt)
  const exerciseBest=new Map<string,{set:LoggedSet;est:number}>()
  completed.forEach(l=>l.exercises.forEach(e=>e.sets.filter(s=>s.completed&&!s.warmup).forEach(s=>{const est=epley(s.weightKg,s.reps);if(est>(exerciseBest.get(e.exerciseId)?.est??0))exerciseBest.set(e.exerciseId,{set:s,est})})))
  return <section className="page"><p className="eyebrow">PROGRESS RECORD</p><h1>{tr('history').toUpperCase()}</h1><div className="stat-row"><div><strong>{completed.length}</strong><span>WORKOUTS</span></div><div><strong>{Math.round(completed.reduce((n,l)=>n+workoutVolume(l),0)).toLocaleString()}</strong><span>KG VOLUME</span></div><div><strong>{exerciseBest.size}</strong><span>EXERCISES</span></div></div><h2 className="section-title">EXERCISE RECORDS</h2><div className="record-list">{[...exerciseBest.entries()].sort((a,b)=>b[1].est-a[1].est).slice(0,12).map(([id,best])=><button key={id} onClick={()=>onExercise(id)}><span><b>{exercises.find(e=>e.id===id)?.name}</b><small>{tr('estimated1rm')} {roundWeight(displayWeight(best.est,settings.unit))} {settings.unit}</small></span><strong>{roundWeight(displayWeight(best.set.weightKg,settings.unit))} × {best.set.reps}</strong></button>)}</div>{completed.length===0&&<div className="empty-state"><h2>NO TRAINING HISTORY YET</h2><p>Finish your first workout and your strength progress will appear here.</p></div>}</section>
}

function Profile({settings,tr,onSettings,onExport,onImport,onDelete}:{settings:Settings;tr:(k:Parameters<typeof translate>[1])=>string;onSettings:(p:Partial<Settings>)=>Promise<void>;onExport:()=>void;onImport:()=>void;onDelete:()=>void}){
  return <section className="page"><p className="eyebrow">DEVICE SETTINGS</p><h1>{tr('profile').toUpperCase()}</h1><div className="settings-list"><label><span>{tr('language')}</span><select value={settings.language} onChange={e=>onSettings({language:e.target.value as Language})}><option value="en">English</option><option value="fi">Suomi</option></select></label><label><span>{tr('units')}</span><select value={settings.unit} onChange={e=>onSettings({unit:e.target.value as Unit})}><option value="kg">kg</option><option value="lb">lb</option></select></label><label><span>{tr('autoRest')}</span><input type="checkbox" checked={settings.autoRest} onChange={e=>onSettings({autoRest:e.target.checked})}/></label><div><span>{tr('trainingDays')}</span><DayPicker value={settings.trainingDays} onChange={(days)=>onSettings({trainingDays:days})} lang={settings.language}/></div></div><h2 className="section-title">{tr('data').toUpperCase()}</h2><div className="data-actions"><button onClick={onExport}>{tr('export')}</button><button onClick={onImport}>{tr('import')}</button><button className="danger" onClick={onDelete}>{tr('delete')}</button></div><p className="privacy-note">Workout data stays in this browser. No analytics, ads or account required.</p></section>
}

function WorkoutMode({log,workout,exerciseIndex,exercises,settings,tr,history,onSet,onDoneSet,onAddSet,onDeleteSet,onExerciseIndex,onFinish,onInfo,onAddExercise,restSeconds,restRunning,onRestAdd,onRestSkip}:{log:WorkoutLog;workout?:ProgramWorkout;exerciseIndex:number;exercises:Exercise[];settings:Settings;tr:(k:Parameters<typeof translate>[1])=>string;history:WorkoutLog[];onSet:(i:number,p:Partial<LoggedSet>)=>void;onDoneSet:(i:number)=>void;onAddSet:()=>void;onDeleteSet:(i:number)=>void;onExerciseIndex:(i:number)=>void;onFinish:()=>void;onInfo:(id:string)=>void;onAddExercise:()=>void;restSeconds:number;restRunning:boolean;onRestAdd:()=>void;onRestSkip:()=>void}){
  const exLog=log.exercises[exerciseIndex]; if(!exLog)return null
  const ex=exercises.find(e=>e.id===exLog.exerciseId)!; const pe=workout?.exercises.find(p=>p.exerciseId===ex.id)
  const prev=history.find(l=>l.id!==log.id&&l.exercises.some(e=>e.exerciseId===ex.id))?.exercises.find(e=>e.exerciseId===ex.id)?.sets.filter(s=>s.completed) ?? []
  return <section className="workout-mode"><div className="workout-head"><div><p>{log.workoutName.toUpperCase()}</p><strong>{formatDuration(Math.floor((Date.now()-new Date(log.startedAt).getTime())/1000))}</strong></div><span>{exerciseIndex+1} / {log.exercises.length}</span></div><div className="progress-line"><i style={{width:`${((exerciseIndex+1)/log.exercises.length)*100}%`}}/></div><article className="current-exercise"><div className="exercise-top"><div><p className="eyebrow">CURRENT EXERCISE</p><h1>{ex.name.toUpperCase()}</h1><p>{ex.primary.join(' · ')}{ex.secondary.length?` · ${ex.secondary.join(' · ')}`:''}</p></div><MuscleFigure primary={ex.primary} secondary={ex.secondary} compact/></div><div className="target-line"><strong>{pe?.sets ?? exLog.sets.length} × {pe?.repMin ?? ex.repRange[0]}–{pe?.repMax ?? ex.repRange[1]}</strong><span>{Math.round((pe?.restSeconds??ex.restSeconds)/60*10)/10} MIN REST</span></div><div className="set-header"><span>{tr('set')}</span><span>{tr('previous')}</span><span>{settings.unit.toUpperCase()}</span><span>{tr('reps')}</span><span>{tr('done')}</span></div><div className="set-list">{exLog.sets.map((s,i)=><div key={s.id} className={`set-row ${s.completed?'complete':''}`}><button className="warmup-toggle" onClick={()=>onSet(i,{warmup:!s.warmup})} aria-label={`Mark set ${i+1} warm-up`}>{s.warmup?'W':i+1}</button><span className="previous-value">{prev[i]?`${roundWeight(displayWeight(prev[i]!.weightKg,settings.unit))}×${prev[i]!.reps}`:'—'}</span><input aria-label={`Set ${i+1} weight`} inputMode="decimal" type="number" step="0.5" value={s.weightKg?roundWeight(displayWeight(s.weightKg,settings.unit)):''} onChange={e=>onSet(i,{weightKg:inputToKg(Number(e.target.value),settings.unit)})}/><input aria-label={`Set ${i+1} reps`} inputMode="numeric" type="number" value={s.reps||''} onChange={e=>onSet(i,{reps:Number(e.target.value)})}/><button className="done-set" onClick={()=>s.completed?onSet(i,{completed:false}):onDoneSet(i)} aria-pressed={s.completed}>✓</button><button className="delete-set" aria-label={`Delete set ${i+1}`} onClick={()=>onDeleteSet(i)}>×</button></div>)}</div><div className="workout-tools"><button onClick={onAddSet}>+ SET</button><button onClick={()=>onInfo(ex.id)}>{tr('instructions')}</button><button onClick={onAddExercise}>+ EXERCISE</button></div><div className="exercise-nav"><button disabled={exerciseIndex===0} onClick={()=>onExerciseIndex(exerciseIndex-1)}>← PREV</button>{exerciseIndex<log.exercises.length-1?<button className="primary" onClick={()=>onExerciseIndex(exerciseIndex+1)}>NEXT →</button>:<button className="primary" onClick={onFinish}>{tr('finish').toUpperCase()}</button>}</div></article>{restRunning&&<div className="rest-bar" aria-live="polite"><div><small>{tr('rest')}</small><strong>{formatDuration(restSeconds)}</strong></div><button onClick={onRestAdd}>+30 SEC</button><button onClick={onRestSkip}>{tr('skip')}</button></div>}</section>
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
