import { useState } from 'react'
import type { Exercise, LoggedSet, Program, ProgramWorkout, Settings, WorkoutLog } from './types'
import { translate } from './i18n'
import { displayWeight, epley, roundWeight, workoutVolume } from './utils'
import { addDays, fullDate, localDateKey, locale, logsOnDate, orderedDays, parseLocalDate, scheduledWorkout, startOfWeek, upcomingWorkouts, weekdayName, weekOrder } from './schedule'

type Shared = { settings: Settings; exercises: Exercise[]; onExercise: (id: string) => void }
const workingSets = (workout: ProgramWorkout) => workout.exercises.reduce((n, exercise) => n + exercise.sets, 0)
const letter = (program: Program, workout: ProgramWorkout) => String.fromCharCode(65 + program.workouts.findIndex(w => w.id === workout.id))

export function DayPicker({ value, onChange, lang }: { value: number[]; onChange: (days: number[]) => void; lang: Settings['language'] }) {
  return <div className="day-picker">{weekOrder.map(day => <button key={day} className={value.includes(day) ? 'selected' : ''} aria-label={weekdayName(day, lang)} aria-pressed={value.includes(day)} onClick={() => {
    const next = value.includes(day) ? value.filter(d => d !== day) : [...value, day]
    if (next.length) onChange(orderedDays(next))
  }}>{weekdayName(day, lang, true)}</button>)}</div>
}

function PlanBanner({ program, settings, onOpen }: { program: Program; settings: Settings; onOpen?: () => void }) {
  const tr = (key: Parameters<typeof translate>[1]) => translate(settings.language, key)
  return <div className="selected-plan"><div><p className="eyebrow">{tr('selectedPlan')}</p><strong>{program.name}</strong><p>{orderedDays(settings.trainingDays).map(day => weekdayName(day, settings.language, true)).join(' · ')} · {program.duration}</p></div>{onOpen && <button className="text-button" onClick={onOpen}>{tr('viewPlan')} →</button>}</div>
}

export function ExercisePreview({ workout, exercises, settings, onExercise }: Shared & { workout: ProgramWorkout }) {
  const tr = (key: Parameters<typeof translate>[1]) => translate(settings.language, key)
  return <ol className="plan-exercises">{workout.exercises.map((item, index) => {
    const exercise = exercises.find(ex => ex.id === item.exerciseId)
    return <li key={`${item.exerciseId}-${index}`}><span className="exercise-order">{String(index + 1).padStart(2, '0')}</span><div><button onClick={() => onExercise(item.exerciseId)} disabled={!exercise}>{exercise?.name ?? item.exerciseId}</button><small>{exercise?.primary.join(' · ')}</small><small>{item.restSeconds} s {tr('rest').toLowerCase()}{item.note ? ` · ${item.note}` : ''}</small></div><b>{item.sets} × {item.repMin}–{item.repMax}{item.exerciseId === 'plank' ? ' s' : ''}</b></li>
  })}</ol>
}

export function Programs({ programs, settings, exercises, onExercise, choose, newCustom, edit, remove, onCalendar }: Shared & { programs: Program[]; choose: (id: string) => void; newCustom: () => void; edit: (p: Program) => void; remove: (id: string) => void; onCalendar: () => void }) {
  const tr = (key: Parameters<typeof translate>[1]) => translate(settings.language, key)
  const active = programs.find(program => program.id === settings.activeProgramId)
  const ordered = programs.slice().sort((a, b) => Number(b.id === settings.activeProgramId) - Number(a.id === settings.activeProgramId) || Number(!!b.featured) - Number(!!a.featured))
  return <section className="page"><div className="page-title"><div><p className="eyebrow">IRONLOG / 02</p><h1>{tr('programs')}</h1></div><button className="square-button" aria-label={tr('createProgram')} onClick={newCustom}>＋</button></div>
    {active && <><PlanBanner program={active} settings={settings}/><button className="primary calendar-link" onClick={onCalendar}>{tr('viewCalendar')} →</button></>}
    <div className="program-grid">{ordered.map(program => <article key={program.id} className={`program-card ${program.featured ? 'featured' : ''} ${program.id === settings.activeProgramId ? 'active-program' : ''}`}>
      {program.featured && <div className="stamp">{tr('recommended')}</div>}<p className="eyebrow">{program.daysPerWeek} {settings.language === 'fi' ? 'PÄIVÄÄ / VIIKKO' : 'DAYS / WEEK'} · {program.duration}</p><h2>{program.name}</h2><p>{program.description}</p>
      <div className="card-meta"><span>{program.focus}</span><span>{program.level}</span></div>
      <details className="program-preview" open={program.id === settings.activeProgramId}><summary>{tr('viewPlan')} · {program.workouts.length} {settings.language === 'fi' ? 'treeniä' : 'sessions'}</summary>{program.workouts.map((workout, index) => <div className="plan-workout" key={workout.id}><p className="eyebrow">{tr('session')} {String.fromCharCode(65 + index)} · {workingSets(workout)} {tr('sets')}</p><h3>{workout.name}</h3><ExercisePreview workout={workout} exercises={exercises} settings={settings} onExercise={onExercise}/></div>)}</details>
      <div className="card-actions">{program.id === settings.activeProgramId ? <button className="primary" onClick={onCalendar}>{tr('selectedPlan')} · {tr('calendar')} →</button> : <button className="primary" onClick={() => choose(program.id)}>{tr('selectProgram')}</button>}{program.custom && <><button onClick={() => edit(program)}>{settings.language === 'fi' ? 'Muokkaa' : 'Edit'}</button><button onClick={() => remove(program.id)}>{settings.language === 'fi' ? 'Poista' : 'Delete'}</button></>}</div>
    </article>)}</div>
  </section>
}

export function WorkoutRecord({ log, exercises, settings, onExercise, onResume }: Shared & { log: WorkoutLog; onResume: (log: WorkoutLog) => void }) {
  const tr = (key: Parameters<typeof translate>[1]) => translate(settings.language, key)
  const totalSets = log.exercises.reduce((n, exercise) => n + exercise.sets.filter(set => set.completed && !set.warmup).length, 0)
  const duration = log.durationSeconds ?? (log.finishedAt ? Math.max(0, (Date.parse(log.finishedAt) - Date.parse(log.startedAt)) / 1000) : 0)
  return <details className="workout-record" data-workout-id={log.id}><summary><div><time dateTime={log.startedAt}>{fullDate(new Date(log.startedAt), settings)}</time><h3>{log.workoutName}</h3><p>{totalSets} {tr('workingSets')} · {log.finishedAt ? `${Math.round(duration / 60)} ${tr('minutes')} · ` : ''}{roundWeight(displayWeight(workoutVolume(log), settings.unit)).toLocaleString(locale(settings))} {settings.unit}</p></div><span className={`record-status ${log.finishedAt ? 'finished' : ''}`}>{log.finishedAt ? tr('completed') : tr('inProgress')} <span aria-hidden="true">+</span></span></summary>
    <div className="workout-record-body"><p className="muted">{new Date(log.startedAt).toLocaleTimeString(locale(settings), { hour: '2-digit', minute: '2-digit' })}{log.finishedAt ? `–${new Date(log.finishedAt).toLocaleTimeString(locale(settings), { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
      {log.exercises.map((entry, index) => {
        const exercise = exercises.find(ex => ex.id === entry.exerciseId)
        return <div className="logged-exercise" key={`${entry.exerciseId}-${index}`}><button className="text-button" onClick={() => onExercise(entry.exerciseId)} disabled={!exercise}>{exercise?.name ?? entry.exerciseId}</button>
          {entry.sets.length ? <table><caption className="sr-only">{exercise?.name ?? entry.exerciseId} · {tr('loggedSets')}</caption><thead><tr><th scope="col">{tr('set')}</th><th scope="col">{settings.unit}</th><th scope="col">{entry.exerciseId === 'plank' ? 's' : tr('reps')}</th><th scope="col">{tr('details')}</th></tr></thead><tbody>{entry.sets.map((set, setIndex) => <tr key={set.id} className={set.completed ? '' : 'uncompleted'}><th scope="row">{setIndex + 1}{set.warmup ? ' W' : ''}</th><td>{roundWeight(displayWeight(set.weightKg, settings.unit))}</td><td>{set.reps}</td><td>{set.completed ? tr('completed') : tr('skipped')}{set.warmup ? ` · ${tr('warmup')}` : ''}</td></tr>)}</tbody></table> : <p className="muted">{tr('skipped')}</p>}
        </div>
      })}{log.notes && <p className="workout-notes"><b>{tr('notes')}: </b>{log.notes}</p>}{!log.finishedAt && <button className="primary" onClick={() => onResume(log)}>{tr('resumeWorkout')}</button>}
    </div>
  </details>
}

export function History({ logs, settings, exercises, onExercise, onResume }: Shared & { logs: WorkoutLog[]; onResume: (log: WorkoutLog) => void }) {
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const tr = (key: Parameters<typeof translate>[1]) => translate(settings.language, key)
  const completed = logs.filter(log => log.finishedAt)
  const visible = logs.filter(log => {
    const date = localDateKey(new Date(log.startedAt))
    const text = [log.workoutName, ...log.exercises.map(entry => exercises.find(ex => ex.id === entry.exerciseId)?.name ?? entry.exerciseId)].join(' ').toLocaleLowerCase()
    return (!from || date >= from) && (!to || date <= to) && text.includes(query.trim().toLocaleLowerCase())
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const best = new Map<string, { set: LoggedSet; est: number }>()
  completed.forEach(log => log.exercises.forEach(exercise => exercise.sets.filter(set => set.completed && !set.warmup).forEach(set => {
    const est = epley(set.weightKg, set.reps)
    if (!best.has(exercise.exerciseId) || est > best.get(exercise.exerciseId)!.est) best.set(exercise.exerciseId, { set, est })
  })))
  return <section className="page history-page"><p className="eyebrow">IRONLOG / 04</p><h1>{tr('history')}</h1><div className="stat-row"><div><strong>{completed.length}</strong><span>{tr('workoutCount')}</span></div><div><strong>{Math.round(displayWeight(completed.reduce((n, log) => n + workoutVolume(log), 0), settings.unit)).toLocaleString(locale(settings))}</strong><span>{tr('totalVolume')} / {settings.unit}</span></div><div><strong>{best.size}</strong><span>{tr('exercises')}</span></div></div>
    <h2 className="section-title">{tr('workoutLog')}</h2><div className="history-filters"><label className="field-label search-filter">{tr('searchWorkouts')}<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label><label className="field-label">{tr('fromDate')}<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label className="field-label">{tr('toDate')}<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label></div>{(query || from || to) && <button className="text-button" onClick={() => { setQuery(''); setFrom(''); setTo('') }}>{tr('clearFilters')}</button>}
    <div className="workout-record-list">{visible.map(log => <WorkoutRecord key={log.id} log={log} settings={settings} exercises={exercises} onExercise={onExercise} onResume={onResume}/>)}</div>
    {!visible.length && <div className="empty-state"><p>{logs.length ? tr('noMatches') : tr('noWorkouts')}</p></div>}
    {!!best.size && <><h2 className="section-title">{tr('exerciseRecords')}</h2><div className="record-list">{[...best.entries()].sort((a, b) => b[1].est - a[1].est).map(([id, record]) => <button key={id} onClick={() => onExercise(id)} disabled={!exercises.some(ex => ex.id === id)}><span><b>{exercises.find(ex => ex.id === id)?.name ?? id}</b><small>{tr('estimated1rm')} {roundWeight(displayWeight(record.est, settings.unit))} {settings.unit}</small></span><strong>{roundWeight(displayWeight(record.set.weightKg, settings.unit))} × {record.set.reps}</strong></button>)}</div></>}
  </section>
}

export function Calendar({ program, settings, exercises, logs, onExercise, onStart, onResume, onDays, selectedDate, onDate, onPrograms, today }: Shared & { program?: Program; logs: WorkoutLog[]; onStart: (workout: ProgramWorkout) => void; onResume: (log: WorkoutLog) => void; onDays: (days: number[]) => void; selectedDate: string; onDate: (date: string) => void; onPrograms: () => void; today: Date }) {
  const selected = parseLocalDate(selectedDate)
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1, 12))
  const tr = (key: Parameters<typeof translate>[1]) => translate(settings.language, key)
  const todayKey = localDateKey(today)
  const first = startOfWeek(month)
  const workout = scheduledWorkout(program, settings, selected)
  const selectedLogs = logsOnDate(logs, selected)
  const done = selectedLogs.some(log => log.finishedAt && log.programId === program?.id && log.workoutId === workout?.id)
  function selectDate(key: string) { const date = parseLocalDate(key); onDate(key); setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12)) }
  return <section className="page calendar-page"><p className="eyebrow">IRONLOG / 03</p><h1>{tr('calendar')}</h1>{program ? <PlanBanner program={program} settings={settings} onOpen={onPrograms}/> : <button className="primary" onClick={onPrograms}>{tr('browsePrograms')}</button>}
    <details className="schedule-settings"><summary>{tr('trainingDays')}</summary><DayPicker value={settings.trainingDays} onChange={onDays} lang={settings.language}/><p>{tr('trainingDaysHelp')}</p><p className="muted">{tr('scheduleChanged')}</p></details>
    <p className="schedule-help">{tr('scheduleHelp')}</p>
    <div className="calendar-toolbar"><button aria-label={tr('previousMonth')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}>←</button><h2 aria-live="polite">{month.toLocaleDateString(locale(settings), { month: 'long', year: 'numeric' })}</h2><button aria-label={tr('nextMonth')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}>→</button></div>
    <div className="calendar-jump"><button className="text-button" onClick={() => selectDate(todayKey)}>{tr('today')}</button><label>{tr('goToDate')}<input type="date" aria-label={tr('goToDate')} value={selectedDate} min="1000-01-01" max="9999-12-31" onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) selectDate(event.target.value) }}/></label></div>
    <div className="calendar-weekdays" aria-hidden="true">{weekOrder.map(day => <span key={day}>{weekdayName(day, settings.language, true)}</span>)}</div>
    <div className="calendar-grid" role="group" aria-label={tr('calendar')}>{Array.from({ length: 42 }, (_, index) => {
      const date = addDays(first, index)
      const key = localDateKey(date)
      const planned = scheduledWorkout(program, settings, date)
      const entries = logsOnDate(logs, date)
      const completed = entries.some(log => log.finishedAt)
      const active = entries.some(log => !log.finishedAt)
      const status = completed ? tr('completed') : active ? tr('inProgress') : planned ? key < todayKey ? tr('notLogged') : tr('scheduled') : tr('restDay')
      return <button key={key} data-date={key} className={`calendar-day ${date.getMonth() !== month.getMonth() ? 'other-month' : ''} ${planned ? 'training-day' : ''} ${completed ? 'day-complete' : ''} ${key === selectedDate ? 'selected-day' : ''}`} aria-pressed={key === selectedDate} aria-current={key === todayKey ? 'date' : undefined} aria-label={`${fullDate(date, settings)} · ${status}${planned ? ` · ${planned.name}` : ''}${entries.length ? ` · ${entries.length} ${tr('workoutCount')}` : ''}`} onClick={() => selectDate(key)}><span>{date.getDate()}</span><b>{completed ? '✓' : active ? '…' : planned && program ? letter(program, planned) : '·'}</b></button>
    })}</div>
    <div className="calendar-legend"><span>✓ {tr('completed')}</span><span>… {tr('inProgress')}</span>{program?.workouts.map(item => <span key={item.id}><b>{letter(program, item)}</b> {item.name}</span>)}</div>
    <div className="calendar-detail" aria-live="polite"><p className="eyebrow">{fullDate(selected, settings)}</p>
      {workout ? <article className="scheduled-card"><p className="eyebrow">{done ? tr('completed') : selectedDate < todayKey ? tr('notLogged') : tr('scheduled')}</p><h2>{workout.name}</h2><p>{workout.exercises.length} {tr('exercises')} · {workingSets(workout)} {tr('workingSets')}</p><ExercisePreview workout={workout} settings={settings} exercises={exercises} onExercise={onExercise}/>{!done && selectedDate <= todayKey && <button className="primary calendar-link" onClick={() => onStart(workout)}>{tr('startThisWorkout')}</button>}{selectedDate > todayKey && <p className="muted preview-note">{tr('previewOnly')}</p>}</article> : <div className="rest-day-card"><h2>{settings.scheduleStartDate && selectedDate < settings.scheduleStartDate ? tr('noPlanOnDate') : tr('restDay')}</h2>{settings.scheduleStartDate && selectedDate < settings.scheduleStartDate && <p>{tr('planStarts')}: {fullDate(parseLocalDate(settings.scheduleStartDate), settings)}</p>}</div>}
    </div>
    {!!selectedLogs.length && <><h2 className="section-title">{tr('recordedOnDay')}</h2>{selectedLogs.map(log => <WorkoutRecord key={log.id} log={log} settings={settings} exercises={exercises} onExercise={onExercise} onResume={onResume}/>)}</>}
  </section>
}

export function Today({ program, settings, logs, exercises, onExercise, onStart, onCalendar, onPrograms, onHistory, today }: Shared & { program?: Program; logs: WorkoutLog[]; onStart: (workout: ProgramWorkout) => void; onCalendar: (date?: string) => void; onPrograms: () => void; onHistory: () => void; today: Date }) {
  const tr = (key: Parameters<typeof translate>[1]) => translate(settings.language, key)
  const upcoming = upcomingWorkouts(program, settings, logs, today)
  const next = upcoming[0]
  const finishedToday = logsOnDate(logs, today).filter(log => log.finishedAt)
  const last = logs.find(log => log.finishedAt)
  if (!program) return <section className="page"><h1>{tr('today')}</h1><button className="primary" onClick={onPrograms}>{tr('browsePrograms')}</button></section>
  return <section className="page today-page"><p className="eyebrow">{fullDate(today, settings)}</p><h1>{tr('today')}</h1><PlanBanner program={program} settings={settings} onOpen={onPrograms}/>
    {!!finishedToday.length && <div className="day-status"><strong>✓ {tr('completed')}</strong><button className="text-button" onClick={onHistory}>{tr('viewHistory')} →</button></div>}
    {!scheduledWorkout(program, settings, today) && <p className="rest-day-note">{tr('restDay')} · {tr('nextWorkout')}: {next ? fullDate(next.date, settings) : '—'}</p>}
    {next && <article className="session-sheet"><p className="eyebrow">{tr('nextWorkout')} · {fullDate(next.date, settings)}</p><div className="session-number">{tr('session')} {letter(program, next.workout)}</div><h2>{next.workout.name}</h2><p>{next.workout.exercises.length} {tr('exercises')} · {workingSets(next.workout)} {tr('workingSets')} · {program.duration}</p><ExercisePreview workout={next.workout} exercises={exercises} settings={settings} onExercise={onExercise}/><button className="primary massive" onClick={() => onStart(next.workout)}>{tr('startWorkout').toUpperCase()}</button></article>}
    <div className="section-heading"><h2 className="section-title">{tr('upcoming')}</h2><button className="text-button" onClick={() => onCalendar()}>{tr('viewCalendar')} →</button></div><div className="upcoming-list">{upcoming.map(({ date, workout }) => <button key={localDateKey(date)} onClick={() => onCalendar(localDateKey(date))}><time dateTime={localDateKey(date)}>{date.toLocaleDateString(locale(settings), { weekday: 'short', day: 'numeric', month: 'short' })}</time><strong>{workout.name}</strong><span>{workout.exercises.length} {tr('exercises')} →</span></button>)}</div>
    {last && <div className="last-block"><p className="eyebrow">{tr('lastSession')} · {fullDate(new Date(last.startedAt), settings)}</p><strong>{last.workoutName}</strong><button className="text-button" onClick={onHistory}>{tr('viewHistory')} →</button></div>}
  </section>
}
