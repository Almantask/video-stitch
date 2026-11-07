const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})

export function compareNaturalNames(a: string, b: string): number {
  const cmp = naturalCollator.compare(a, b)
  if (cmp !== 0) return cmp
  return a.localeCompare(b)
}

export function sortByFileName<T extends { fileName: string }>(
  items: readonly T[],
  direction: 'asc' | 'desc' = 'asc'
): T[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => factor * compareNaturalNames(a.fileName, b.fileName))
}

export function sortFilePathsAlphabetically(filePaths: readonly string[]): string[] {
  const getBase = (p: string): string => {
    const normalized = p.replace(/\\/g, '/')
    const idx = normalized.lastIndexOf('/')
    return idx >= 0 ? normalized.slice(idx + 1) : normalized
  }
  return [...filePaths].sort((a, b) => {
    const baseCmp = compareNaturalNames(getBase(a), getBase(b))
    if (baseCmp !== 0) return baseCmp
    return compareNaturalNames(a, b)
  })
}
