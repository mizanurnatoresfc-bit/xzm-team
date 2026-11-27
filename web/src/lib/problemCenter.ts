export const PROBLEM_VIEWS = [
  ['summary', 'সারসংক্ষেপ'],
  ['unassigned', 'দায়িত্ব দেওয়া হয়নি'],
  ['mine', 'আমার দায়িত্ব'],
  ['working', 'কাজ চলছে'],
  ['late', 'সময় পার হয়েছে'],
  ['review', 'সমাধান যাচাই'],
  ['resolved', 'সমাধান হয়েছে'],
  ['history', 'সকল সমস্যার ইতিহাস'],
  ['hub-report', 'হাবভিত্তিক রিপোর্ট'],
  ['employee-report', 'কর্মীভিত্তিক রিপোর্ট'],
] as const

export type ProblemView = typeof PROBLEM_VIEWS[number][0]

export function dhakaInstant(local: string) {
  return new Date(`${local}+06:00`).toISOString()
}
