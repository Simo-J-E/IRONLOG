import type { Language } from './types'

const t = {
  en: {
    today:'Today', programs:'Programs', history:'History', profile:'Profile', startWorkout:'Start workout', lastSession:'Last session', nextTarget:'Next target', exercises:'exercises', workingSets:'working sets', rest:'REST', skip:'Skip', instructions:'Instructions', finish:'Finish workout', complete:'Work complete', duration:'Duration', totalVolume:'Total volume', prs:'Personal records', data:'Data', export:'Export my data', import:'Import data', delete:'Delete all data', language:'Language', units:'Units', autoRest:'Automatic rest timer', selectProgram:'Use program', createProgram:'Create program', addExercise:'Add exercise', save:'Save', cancel:'Cancel', estimated1rm:'Estimated 1RM', noHistory:'No history yet', viewHistory:'View history', previous:'Previous', done:'Done', set:'Set', reps:'Reps', how:'How to perform', mistakes:'Common mistakes', best:'Your best', trainingDays:'Training days', choose:'Choose your program', getStarted:'Get started', startTraining:'Start training', recommended:'Recommended', plateCalculator:'Plate calculator'
  },
  fi: {
    today:'Tänään', programs:'Ohjelmat', history:'Historia', profile:'Profiili', startWorkout:'Aloita treeni', lastSession:'Edellinen treeni', nextTarget:'Seuraava tavoite', exercises:'liikettä', workingSets:'työsarjaa', rest:'TAUKO', skip:'Ohita', instructions:'Ohjeet', finish:'Lopeta treeni', complete:'Treeni valmis', duration:'Kesto', totalVolume:'Kokonaisvolyymi', prs:'Omat ennätykset', data:'Data', export:'Vie tiedot', import:'Tuo tiedot', delete:'Poista kaikki tiedot', language:'Kieli', units:'Yksiköt', autoRest:'Automaattinen taukoajastin', selectProgram:'Ota käyttöön', createProgram:'Luo ohjelma', addExercise:'Lisää liike', save:'Tallenna', cancel:'Peruuta', estimated1rm:'Arvioitu 1RM', noHistory:'Ei historiaa vielä', viewHistory:'Näytä historia', previous:'Edellinen', done:'Valmis', set:'Sarja', reps:'Toistot', how:'Suoritustekniikka', mistakes:'Yleiset virheet', best:'Paras tulos', trainingDays:'Treenipäivät', choose:'Valitse ohjelma', getStarted:'Aloita', startTraining:'Aloita treenaaminen', recommended:'Suositus', plateCalculator:'Levylaskuri'
  }
} as const

export function translate(lang: Language, key: keyof typeof t.en) { return t[lang][key] }
