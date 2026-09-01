import type { Exercise, Program } from './types'

const baseInstructions = (name: string) => [
  `Set up in a stable position for ${name}.`,
  'Use a controlled range of motion.',
  'Keep the working muscles under tension.',
  'Stop the set when technique starts to break down.'
]
const commonMistakes = ['Using momentum instead of control', 'Rushing the eccentric phase', 'Using more weight than can be controlled']

const makeExercise = (
  id: string,
  name: string,
  primary: Exercise['primary'],
  secondary: Exercise['secondary'],
  equipment: string,
  repRange: [number, number],
  restSeconds: number,
  instructions = baseInstructions(name),
  mistakes = commonMistakes
): Exercise => ({ id, name, primary, secondary, equipment, difficulty: 'Intermediate', repRange, restSeconds, instructions, mistakes })

export const exercises: Exercise[] = [
  makeExercise('bench-press','Bench Press',['Chest'],['Triceps','Front deltoids'],'Barbell + Bench',[6,8],180,[
    'Lie on the bench with your eyes approximately underneath the bar.',
    'Plant your feet firmly on the floor.',
    'Pull your shoulder blades slightly back and down.',
    'Grip the bar slightly wider than shoulder width.',
    'Unrack the bar with controlled arms.',
    'Lower the bar toward the lower-middle chest.',
    'Keep your forearms relatively vertical.',
    'Press the bar back up while keeping your upper back stable.'
  ],['Elbows excessively flared','Bouncing the bar','Losing upper-back tension','Lifting hips from the bench','Using weight that cannot be controlled']),
  makeExercise('db-bench','Dumbbell Bench Press',['Chest'],['Triceps','Front deltoids'],'Dumbbells + Bench',[8,12],120),
  makeExercise('incline-bench','Incline Bench Press',['Upper chest'],['Triceps','Front deltoids'],'Barbell + Incline Bench',[6,10],120),
  makeExercise('incline-db','Incline Dumbbell Press',['Upper chest'],['Triceps','Front deltoids'],'Dumbbells + Incline Bench',[8,10],120),
  makeExercise('chest-press','Chest Press Machine',['Chest'],['Triceps','Front deltoids'],'Machine',[8,10],120),
  makeExercise('cable-fly','Cable Fly',['Chest'],[], 'Cable machine',[10,12],75),
  makeExercise('pec-deck','Pec Deck',['Chest'],[], 'Machine',[10,12],75),
  makeExercise('push-up','Push-Up',['Chest'],['Triceps','Front deltoids'],'Bodyweight',[8,15],90),
  makeExercise('dips','Dips',['Chest','Triceps'],['Front deltoids'],'Dip station',[6,12],120),
  makeExercise('barbell-curl','Barbell Curl',['Biceps'],['Forearms'],'Barbell',[6,10],90),
  makeExercise('ez-curl','EZ-Bar Curl',['Biceps'],['Forearms'],'EZ bar',[8,10],90),
  makeExercise('db-curl','Dumbbell Curl',['Biceps'],['Forearms'],'Dumbbells',[8,12],75),
  makeExercise('incline-curl','Incline Dumbbell Curl',['Biceps'],[], 'Dumbbells + Bench',[8,12],75),
  makeExercise('hammer-curl','Hammer Curl',['Brachialis','Biceps'],['Forearms'],'Dumbbells',[8,12],75),
  makeExercise('preacher-curl','Preacher Curl',['Biceps'],[], 'Preacher bench',[10,12],75),
  makeExercise('cable-curl','Cable Curl',['Biceps'],['Forearms'],'Cable machine',[10,15],60),
  makeExercise('pushdown','Triceps Pushdown',['Triceps'],[], 'Cable machine',[8,12],75),
  makeExercise('overhead-triceps','Overhead Triceps Extension',['Triceps'],[], 'Cable or dumbbell',[10,12],75),
  makeExercise('skull-crushers','Skull Crushers',['Triceps'],[], 'EZ bar + Bench',[8,12],90),
  makeExercise('close-grip-bench','Close-Grip Bench Press',['Triceps'],['Chest','Front deltoids'],'Barbell + Bench',[6,8],150),
  makeExercise('cable-triceps','Cable Triceps Extension',['Triceps'],[], 'Cable machine',[10,12],75),
  makeExercise('lat-pulldown','Lat Pulldown',['Lats'],['Biceps'],'Cable machine',[8,12],120),
  makeExercise('pull-up','Pull-Up',['Lats','Back'],['Biceps'],'Pull-up bar',[5,10],150),
  makeExercise('barbell-row','Barbell Row',['Back'],['Biceps','Rear deltoids'],'Barbell',[6,10],150),
  makeExercise('db-row','Dumbbell Row',['Back','Lats'],['Biceps'],'Dumbbell + Bench',[8,12],120),
  makeExercise('seated-row','Seated Cable Row',['Back'],['Biceps'],'Cable machine',[8,12],120),
  makeExercise('chest-supported-row','Chest Supported Row',['Back'],['Biceps','Rear deltoids'],'Machine or bench',[8,12],120),
  makeExercise('overhead-press','Overhead Press',['Shoulders'],['Triceps'],'Barbell',[6,10],150),
  makeExercise('db-shoulder','Dumbbell Shoulder Press',['Shoulders'],['Triceps'],'Dumbbells',[8,12],120),
  makeExercise('lateral-raise','Lateral Raise',['Shoulders'],[], 'Dumbbells or cable',[10,15],60),
  makeExercise('rear-delt-fly','Rear Delt Fly',['Rear deltoids'],['Back'],'Dumbbells or machine',[10,15],60),
  makeExercise('face-pull','Face Pull',['Rear deltoids'],['Back'],'Cable machine',[10,15],60),
  makeExercise('squat','Squat',['Quads','Glutes'],['Hamstrings','Core'],'Barbell',[5,10],180),
  makeExercise('leg-press','Leg Press',['Quads','Glutes'],['Hamstrings'],'Machine',[8,12],150),
  makeExercise('rdl','Romanian Deadlift',['Hamstrings','Glutes'],['Back'],'Barbell',[6,10],180),
  makeExercise('leg-extension','Leg Extension',['Quads'],[], 'Machine',[10,15],75),
  makeExercise('leg-curl','Leg Curl',['Hamstrings'],[], 'Machine',[10,15],75),
  makeExercise('calf-raise','Calf Raise',['Calves'],[], 'Machine or bodyweight',[10,15],75),
  makeExercise('cable-crunch','Cable Crunch',['Core'],[], 'Cable machine',[10,15],75),
  makeExercise('hanging-leg-raise','Hanging Leg Raise',['Core'],[], 'Pull-up bar',[8,15],75),
  makeExercise('plank','Plank',['Core'],[], 'Bodyweight',[30,60],60),
  makeExercise('ab-wheel','Ab Wheel',['Core'],[], 'Ab wheel',[6,15],90),
]

const pe = (exerciseId: string, sets: number, repMin: number, repMax: number, restSeconds: number) => ({ exerciseId, sets, repMin, repMax, restSeconds })

export const programs: Program[] = [
  {
    id:'chest-arms', name:'Chest + Arms Growth', description:'High-intensity hypertrophy with progressive overload.', daysPerWeek:3, duration:'50–65 min', focus:'Chest + Arms', level:'Intermediate', featured:true,
    workouts:[
      { id:'ca-a', name:'Chest + Triceps', exercises:[pe('bench-press',4,6,8,180),pe('incline-db',3,8,10,120),pe('cable-fly',3,10,12,75),pe('pushdown',3,8,12,75),pe('overhead-triceps',3,10,12,75)]},
      { id:'ca-b', name:'Arms + Chest', exercises:[pe('close-grip-bench',3,6,8,150),pe('barbell-curl',3,6,10,90),pe('incline-curl',3,8,12,75),pe('hammer-curl',3,8,12,75),pe('chest-press',3,8,10,120),pe('cable-triceps',3,10,12,75)]},
      { id:'ca-c', name:'Heavy Chest + Arms', exercises:[pe('bench-press',4,5,7,180),pe('incline-bench',3,6,10,120),pe('pec-deck',3,10,12,75),pe('ez-curl',3,8,10,90),pe('preacher-curl',2,10,12,75),pe('skull-crushers',3,8,12,90)]}
    ]
  },
  { id:'beginner-full',name:'Beginner Full Body',description:'Simple whole-body base.',daysPerWeek:3,duration:'45–60 min',focus:'Full body',level:'Beginner',workouts:[{id:'bf-a',name:'Full Body A',exercises:[pe('squat',3,8,10,150),pe('bench-press',3,8,10,150),pe('lat-pulldown',3,8,12,120),pe('db-curl',2,10,12,75),pe('pushdown',2,10,12,75)]},{id:'bf-b',name:'Full Body B',exercises:[pe('leg-press',3,10,12,150),pe('overhead-press',3,8,10,120),pe('seated-row',3,8,12,120),pe('rdl',3,8,10,150),pe('plank',3,30,45,60)]}]},
  { id:'upper-body',name:'Upper Body',description:'Balanced upper-body growth.',daysPerWeek:3,duration:'60 min',focus:'Upper body',level:'Intermediate',workouts:[{id:'ub-a',name:'Upper A',exercises:[pe('bench-press',3,6,8,150),pe('seated-row',3,8,10,120),pe('overhead-press',3,8,10,120),pe('lat-pulldown',3,8,12,120),pe('barbell-curl',3,8,10,75),pe('pushdown',3,8,12,75)]}]},
  { id:'ppl',name:'Push / Pull / Legs',description:'Classic three-day split.',daysPerWeek:3,duration:'60–75 min',focus:'Full body split',level:'Intermediate',workouts:[{id:'ppl-push',name:'Push',exercises:[pe('bench-press',4,6,8,180),pe('overhead-press',3,8,10,120),pe('incline-db',3,8,10,120),pe('lateral-raise',3,10,15,60),pe('pushdown',3,8,12,75)]},{id:'ppl-pull',name:'Pull',exercises:[pe('lat-pulldown',4,8,10,120),pe('barbell-row',3,6,10,150),pe('face-pull',3,10,15,60),pe('barbell-curl',3,6,10,90),pe('hammer-curl',3,8,12,75)]},{id:'ppl-legs',name:'Legs',exercises:[pe('squat',4,5,8,180),pe('leg-press',3,8,12,150),pe('rdl',3,6,10,180),pe('leg-curl',3,10,15,75),pe('calf-raise',3,10,15,75)]}]},
  { id:'upper-lower',name:'Upper / Lower',description:'Four-day upper/lower split.',daysPerWeek:4,duration:'60 min',focus:'Full body',level:'Intermediate',workouts:[{id:'ul-upper',name:'Upper',exercises:[pe('bench-press',3,6,8,150),pe('seated-row',3,8,10,120),pe('overhead-press',3,8,10,120),pe('lat-pulldown',3,8,12,120),pe('db-curl',2,10,12,75),pe('pushdown',2,10,12,75)]},{id:'ul-lower',name:'Lower',exercises:[pe('squat',3,6,8,180),pe('rdl',3,6,10,180),pe('leg-press',3,10,12,150),pe('leg-curl',3,10,15,75),pe('calf-raise',3,10,15,75)]}]},
  { id:'strength',name:'Strength Basics',description:'Simple compound strength practice.',daysPerWeek:3,duration:'60 min',focus:'Strength',level:'Intermediate',workouts:[{id:'sb-a',name:'Strength A',exercises:[pe('squat',4,5,6,180),pe('bench-press',4,5,6,180),pe('barbell-row',4,6,8,150)]},{id:'sb-b',name:'Strength B',exercises:[pe('rdl',4,5,6,180),pe('overhead-press',4,5,6,180),pe('pull-up',4,5,8,150)]}]}
]

export const findExercise = (id: string) => exercises.find(e => e.id === id)
