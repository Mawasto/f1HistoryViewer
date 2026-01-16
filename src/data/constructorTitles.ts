export const CONSTRUCTOR_TITLES: Record<string, number> = {
  vanwall: 1,
  cooper: 2,
  ferrari: 16,
  brm: 1,
  lotus: 7,
  brabham: 2,
  matra: 1,
  tyrrell: 1,
  mclaren: 10,
  williams: 9,
  benetton: 1,
  renault: 2,
  brawn: 1,
  mercedes: 8,
  red_bull: 7,
}

export const getConstructorTitles = (constructorId: string | undefined): number => {
  if (!constructorId) return 0
  const titles = CONSTRUCTOR_TITLES[constructorId]
  return typeof titles === 'number' ? titles : 0
}