import { describe, expect, it } from 'vitest'
import { detectNewPr, epley, kgToLb, lbToKg, volume } from './utils'
import type { WorkoutLog } from './types'

describe('training calculations',()=>{
  it('calculates Epley estimated 1RM',()=>expect(epley(100,5)).toBeCloseTo(116.67,2))
  it('converts units without destroying value',()=>expect(lbToKg(kgToLb(82.5))).toBeCloseTo(82.5,5))
  it('excludes warm-up sets from volume',()=>expect(volume([{id:'1',weightKg:20,reps:10,completed:true,warmup:true},{id:'2',weightKg:80,reps:8,completed:true}])).toBe(640))
  it('detects a new estimated 1RM PR',()=>{
    const old:WorkoutLog={id:'old',programId:'p',workoutId:'w',workoutName:'W',startedAt:'2026-01-01',finishedAt:'2026-01-01',exercises:[{exerciseId:'bench-press',sets:[{id:'s',weightKg:80,reps:8,completed:true}]}]}
    expect(detectNewPr([old],'bench-press',[{id:'n',weightKg:85,reps:8,completed:true}]).isPr).toBe(true)
  })
})
