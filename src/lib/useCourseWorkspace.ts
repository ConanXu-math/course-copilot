import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, PersonalSettings, ReadingState } from './types';
import { getCourses, getCourseState, getStorageInfo, migrateBrowserData, saveCourseState, updateSettings } from './storage';

type Snapshot = { bookId: string; state: ReadingState };
const describe = (error: unknown) => error instanceof Error ? error.message : '暂时无法保存，请重试。';

export function useCourseWorkspace() {
  const [courses, setCourses] = useState<Book[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [settings, setSettings] = useState<PersonalSettings | null>(null);
  const [directory, setDirectory] = useState('');
  const [reading, setReading] = useState<ReadingState>({ page: 1, bookmarks: [], notes: [], conversationId: '', messages: [], artifacts: [] });
  const [bootError, setBootError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveError, setSaveError] = useState('');
  const [pending, setPending] = useState(false);
  const [settingsPending, setSettingsPending] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const settingsCount = useRef(0);
  const failedSettings = useRef<Partial<PersonalSettings> | null>(null);
  const [switching, setSwitching] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const preferenceQueue = useRef(Promise.resolve());
  const transition = useRef(false);
  const saved = useRef<Snapshot | null>(null);
  const snapshot = useMemo(() => book ? { bookId: book.id, state: reading } : null, [book?.id, reading]);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  const save = useCallback((value: Snapshot): Promise<void> => {
    if (saved.current === value) return Promise.resolve();
    setPending(true);
    const operation = saveQueue.current.catch(() => {}).then(() => saveCourseState(value.bookId, value.state));
    saveQueue.current = operation;
    void operation.then(() => {
      saved.current = value;
      if (latest.current === value) { setPending(false); setSaveError(''); }
    }, error => { setSaveError(describe(error)); setPending(false); });
    return operation;
  }, []);

  const savePreferences = useCallback((patch: Partial<PersonalSettings>): Promise<void> => {
    settingsCount.current++; setSettingsPending(true);
    let attempted = patch;
    const operation = preferenceQueue.current.catch(() => {}).then(async () => {
      attempted = { ...failedSettings.current, ...patch };
      const value = await updateSettings(attempted);
      setSettings(value);
    });
    preferenceQueue.current = operation;
    void operation.then(() => {
      failedSettings.current = null; setSettingsError('');
    }, error => {
      failedSettings.current = { ...failedSettings.current, ...attempted };
      setSettingsError(`个人设置未保存：${describe(error)}`);
    }).finally(() => {
      settingsCount.current--; setSettingsPending(settingsCount.current > 0);
    });
    return operation;
  }, []);

  const flush = useCallback(async () => {
    if (latest.current) await save(latest.current);
    await saveQueue.current;
    await preferenceQueue.current.catch(() => {});
    if (failedSettings.current) await savePreferences(failedSettings.current);
  }, [save, savePreferences]);

  const openBook = useCallback(async (next: Book) => {
    if (transition.current) return false;
    if (latest.current?.bookId === next.id) return true;
    transition.current = true;
    setSwitching(true);
    try {
      await flush();
      const state = await getCourseState(next.id);
      setBook(next); setReading(state); setBootError('');
      void savePreferences({ activeCourseId: next.id }).catch(() => {});
      return true;
    } catch (error) { setSaveError(describe(error)); return false; }
    finally { transition.current = false; setSwitching(false); }
  }, [flush, savePreferences]);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const migration = await migrateBrowserData();
        if (abort.signal.aborted) return;
        setWarnings(migration.warnings);
        const [info, books] = await Promise.all([getStorageInfo(abort.signal), getCourses(abort.signal)]);
        const initial = books.find(item => item.id === info.settings.activeCourseId) || books[0];
        const state = initial ? await getCourseState(initial.id, abort.signal) : null;
        if (abort.signal.aborted) return;
        setDirectory(info.directory); setSettings(info.settings); setCourses(books);
        if (initial && state) { setBook(initial); setReading(state); }
        else setBootError('课程目录中还没有教材，请导入一本 PDF。');
      } catch (error) { if (!abort.signal.aborted) setBootError(describe(error)); }
    })();
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    setPending(true);
    const timer = window.setTimeout(() => { void save(snapshot).catch(() => {}); }, 200);
    return () => clearTimeout(timer);
  }, [snapshot, save]);

  useEffect(() => {
    const beforeLeaving = (event: BeforeUnloadEvent) => {
      if ((latest.current && latest.current !== saved.current) || settingsCount.current || failedSettings.current) event.preventDefault();
    };
    // Normal writes are queued. On page exit, wait for older writes before sending the latest value.
    const pagehide = () => {
      const value = latest.current;
      if (value && value !== saved.current) void saveQueue.current.catch(() => {}).then(() => saveCourseState(value.bookId, value.state, { keepalive: true })).catch(() => {});
    };
    window.addEventListener('beforeunload', beforeLeaving);
    window.addEventListener('pagehide', pagehide);
    return () => { window.removeEventListener('beforeunload', beforeLeaving); window.removeEventListener('pagehide', pagehide); };
  }, []);

  return { courses, setCourses, book, setBook, reading, setReading, settings, directory, bootError, warnings, saveError: saveError || settingsError, pending: pending || settingsPending, switching, openBook, flush, savePreferences };
}
