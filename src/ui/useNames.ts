import { useMemo } from 'react'
import { aliasMap, type AliasMap } from '../core/aliases'
import { useStore } from '../data/storeContext'

/** Display names from the Names tab, ready to look up. */
export function useNames(): AliasMap {
  const { data } = useStore()
  return useMemo(() => aliasMap(data?.names ?? []), [data])
}
