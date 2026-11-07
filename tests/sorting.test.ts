import { describe, expect, it } from 'vitest'
import { sortByFileName, sortFilePathsAlphabetically } from '../src/shared/sorting'

describe('Alphabetical & Natural Clip Sorting', () => {
  it('sorts filenames in natural case-insensitive alphabetical order by default', () => {
    const items = [
      { fileName: 'clip_10.mp4' },
      { fileName: 'Clip_2.mp4' },
      { fileName: 'alpha.mp4' },
      { fileName: 'clip_1.mp4' }
    ]

    const sorted = sortByFileName(items, 'asc')
    expect(sorted.map((x) => x.fileName)).toEqual([
      'alpha.mp4',
      'clip_1.mp4',
      'Clip_2.mp4',
      'clip_10.mp4'
    ])
  })

  it('supports reverse alphabetical sorting (Z to A)', () => {
    const items = [{ fileName: 'a.mp4' }, { fileName: 'c.mp4' }, { fileName: 'b.mp4' }]
    const sorted = sortByFileName(items, 'desc')
    expect(sorted.map((x) => x.fileName)).toEqual(['c.mp4', 'b.mp4', 'a.mp4'])
  })

  it('sorts full Windows and POSIX file paths by basename naturally', () => {
    const paths = [
      'E:\\videos\\scene_12.mp4',
      'E:\\videos\\scene_2.mp4',
      'C:\\other\\intro.mp4'
    ]
    expect(sortFilePathsAlphabetically(paths)).toEqual([
      'C:\\other\\intro.mp4',
      'E:\\videos\\scene_2.mp4',
      'E:\\videos\\scene_12.mp4'
    ])
  })
})
