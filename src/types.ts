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
}

export interface Settings {
  id: 'settings'
  language: Language
  unit: Unit
  onboardingDone: boolean
  activeProgramId: string
  trainingDays: number[]
  autoRest: boolean
}
