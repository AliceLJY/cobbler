import { useCallback, useEffect, useState } from 'react';
import { loadNest, type NestData } from '../lib/api';

const EMPTY: NestData = { state: null, todayCard: null, cards: [], offline: true };

export function useNestData() {
  const [data, setData] = useState<NestData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setData(await loadNest());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}
