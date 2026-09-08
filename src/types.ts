export type Muscle = 'Chest' | 'Upper chest' | 'Triceps' | 'Biceps' | 'Brachialis' | 'Forearms' | 'Front deltoids' | 'Shoulders' | 'Rear deltoids' | 'Back' | 'Lats' | 'Quads' | 'Hamstrings' | 'Glutes' | 'Calves' | 'Core'
export type Unit = 'kg' | 'lb'
export type Language = 'en' | 'fi'

export interface Exercise {
  id: string
  name: string
  primary: Muscle[]
  secondary: Muscle[]
  equipment: string
  difficulty: 'Beginner' | 'Intermediate'
  repRange: [number, number]
  restSeconds: number
  instructions: string[]
  mistakes: string[]
  safety?: string
  custom?: boolean
}

export interface ProgramExercise {
  exerciseId: string
  sets: number
  repMin: number
  repMax: number
  restSeconds: number
  note?: string
}

export interface ProgramWorkout {
  id: string
  name: string
  exercises: ProgramExercise[]
}

export interface Program {
  id: string
  name: string
  description: string
  daysPerWeek: number
  duration: string
  focus: string
  level: string
  featured?: boolean
  custom?: boolean
  workouts: ProgramWorkout[]
}

export interface LoggedSet {
  id: string
  weightKg: number
  reps: number
  completed: boolean
  warmup?: boolean
  weightInput?: string
  repsInput?: string
  inputUnit?: Unit
}

export interface ExerciseLog {
  exerciseId: string
  sets: LoggedSet[]
}

export interface WorkoutLog {
  id: string
  programId: string
  workoutId: string
  workoutName: string
  startedAt: string
  finishedAt?: string
  durationSeconds?: number
  exercises: ExerciseLog[]
  notes?: string
  updatedAt?: string
  plan?: ProgramWorkout
  progress?: { exerciseIndex: number; restEndsAt: number | null }
}

export type Collection = 'workouts' | 'programs' | 'exercises' | 'settings'
export type StoredRecord = WorkoutLog | Program | Exercise | Settings
export interface RemoteRecord {
  collection: Collection
  id: string
  revision: number
  data: StoredRecord | null
}
export interface SyncState {
  key: string
  collection: Collection
  id: string
  revision: number
  mutationId: string
  dirty: number
  conflict?: RemoteRecord
}
export interface Account { id: string; username: string; ranked: boolean }

export interface Settings {
  id: 'settings'
  language: Language
  unit: Unit
  onboardingDone: boolean
  activeProgramId: string
  trainingDays: number[]
  autoRest: boolean
}
