import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Grid, useGridRef } from "react-window";
import "./style.css";
import type {
  Boot,
  Cell,
  MonthData,
  NgPair,
  Role,
  RoleRequirement,
  SequenceRule,
  ShiftType,
  Staff,
  UnavailableCondition,
  Violation,
} from "../shared/types";
import { WEEKDAY_LABELS, daysInMonth } from "../shared/types";

declare global {
  interface Window {
    shiftApi: {
      bootstrap: () => Promise<Boot>;
      listRoles: (includeDeleted?: boolean) => Promise<Role[]>;
      saveRole: (payload: { id?: number; name: string; displayOrder?: number }) => Promise<Role[]>;
      setRoleDeleted: (id: number, deleted: boolean) => Promise<Role[]>;
      roleUsage: (id: number) => Promise<number>;
      roleRequirementUsage: (id: number) => Promise<number>;
      listShiftTypes: () => Promise<ShiftType[]>;
      shiftTypeUsage: (id: number) => Promise<{
        shifts: number;
        requirements: number;
        sequenceRules: number;
      }>;
      setShiftTypeDeleted: (id: number, deleted: boolean) => Promise<ShiftType[]>;
      listStaff: () => Promise<Staff[]>;
      staffUsage: (id: number) => Promise<{
        shifts: number;
        ngPairs: number;
        unavailableConditions: number;
      }>;
      setStaffDeleted: (id: number, deleted: boolean) => Promise<Staff[]>;
      saveSettings: (p: unknown) => Promise<Boot>;
      saveConfiguration: (p: unknown) => Promise<Boot>;
      saveRules: (p: unknown) => Promise<Boot>;
      saveUnavailableConditions: (p: unknown) => Promise<UnavailableCondition[]>;
      saveRoleRequirements: (p: unknown) => Promise<unknown>;
      saveConditions: (p: unknown) => Promise<unknown>;
      generateStart: (month: string) => Promise<number>;
      generateCancel: (jobId: number) => Promise<boolean>;
      onGenerateProgress: (
        cb: (p: { jobId: number; assigned: number; total: number; elapsedMs: number }) => void,
      ) => () => void;
      onGenerateDone: (
        cb: (p: MonthData & { jobId: number; violations: Violation[]; timedOut: boolean }) => void,
      ) => () => void;
      onGenerateError: (cb: (p: { jobId: number; message: string }) => void) => () => void;
      createMonth: (m: string) => Promise<MonthData>;
      getMonth: (m: string) => Promise<MonthData>;
      setUnsavedChanges: (hasUnsavedChanges: boolean) => Promise<void>;
      updateCells: (p: unknown) => Promise<unknown>;
      validate: (month: string, cells: unknown) => Promise<Violation[]>;
      exportXlsx: (
        m: string,
      ) => Promise<{ filePath?: string; canceled?: boolean }>;
      onExportRequested: (listener: () => void) => void;
    };
  }
}
const today = new Date();
const initialMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

function App() {
  const [boot, setBoot] = useState<Boot>();
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<MonthData>();
  const [savedData, setSavedData] = useState<MonthData>();
  const [activeMonth, setActiveMonth] = useState<string>();
  const [monthDirty, setMonthDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [page, setPage] = useState<"home" | "conditions" | "edit" | "settings">(
    "home",
  );
  const [notice, setNotice] = useState("");
  const [startupError, setStartupError] = useState("");
  useEffect(() => {
    window.shiftApi.bootstrap().then(setBoot).catch(() => {
      setStartupError("アプリの初期化に失敗しました。データへのアクセス権限を確認して、再起動してください。");
    });
  }, []);
  useEffect(() => {
    void window.shiftApi.setUnsavedChanges(monthDirty || settingsDirty);
  }, [monthDirty, settingsDirty]);
  useEffect(
    () => () => {
      void window.shiftApi.setUnsavedChanges(false);
    },
    [],
  );
  const create = async () => {
    const d = await window.shiftApi.createMonth(month);
    setData(d);
    setSavedData(d);
    setActiveMonth(month);
    setMonthDirty(false);
    setBoot(d);
    setPage("edit");
  };
  const openExistingMonth = async (targetMonth: string) => {
    if (!confirmDiscard()) return;
    discardMonthChanges();
    setSettingsDirty(false);
    const next = await window.shiftApi.getMonth(targetMonth);
    setMonth(targetMonth);
    setData(next);
    setSavedData(next);
    setActiveMonth(targetMonth);
    setMonthDirty(false);
    setBoot(next);
    setPage("edit");
  };
  const discardMonthChanges = () => {
    if (savedData) setData(savedData);
    setMonthDirty(false);
  };
  const confirmDiscard = () =>
    !monthDirty && !settingsDirty
      ? true
      : confirm("未保存の変更があります。保存せずに破棄して移動しますか？");
  const navigate = async (next: "home" | "conditions" | "edit" | "settings") => {
    if (next === page) return;
    if ((next === "conditions" || next === "edit") && (!data || activeMonth !== month)) {
      if (!confirmDiscard()) return;
      discardMonthChanges();
      setSettingsDirty(false);
      await create();
      if (next === "conditions") setPage("conditions");
      return;
    }
    if (!confirmDiscard()) return;
    if (monthDirty) discardMonthChanges();
    if (settingsDirty) setSettingsDirty(false);
    setPage(next);
  };
  const setMonthData = (next: MonthData) => {
    setData(next);
    setMonthDirty(true);
  };
  const markMonthSaved = (next: MonthData) => {
    setData(next);
    setSavedData(next);
    setMonthDirty(false);
  };
  const refreshMasterAndOpenMonth = async () => {
    const nextBoot = await window.shiftApi.bootstrap();
    setBoot(nextBoot);
    if (data) markMonthSaved(await window.shiftApi.getMonth(activeMonth ?? month));
  };
  if (!boot)
    return <main className="loading">{startupError || "起動しています…"}</main>;
  return (
    <div className="app">
      <aside>
        <h1>介護シフト</h1>
        <button
          className={page === "home" ? "active" : ""}
          onClick={() => void navigate("home")}
        >
          ダッシュボード
        </button>
        <button
          className={page === "conditions" ? "active" : ""}
          onClick={() => void navigate("conditions")}
        >
          条件設定
        </button>
        <button
          className={page === "edit" ? "active" : ""}
          onClick={() => void navigate("edit")}
        >
          シフト編集
        </button>
        <button
          className={page === "settings" ? "active" : ""}
          onClick={() => void navigate("settings")}
        >
          マスタ・ルール設定
        </button>
      </aside>
      <main>
        {page === "home" && (
          <Home
            month={month}
            setMonth={setMonth}
            create={create}
            open={openExistingMonth}
            months={boot.months}
          />
        )}{" "}
        {page === "conditions" && data && (
          <Conditions
            data={data}
            month={month}
            setData={setMonthData}
            notify={setNotice}
            onSaved={markMonthSaved}
          />
        )}{" "}
        {page === "edit" && data && (
          <Editor
            data={data}
            setData={setMonthData}
            month={month}
            notify={setNotice}
            onSaved={markMonthSaved}
            hasUnsavedChanges={monthDirty}
          />
        )}{" "}
        {page === "settings" && (
          <Settings
            boot={boot}
            onMasterChanged={refreshMasterAndOpenMonth}
            onDirty={setSettingsDirty}
            onError={setNotice}
            onSaved={(b) => {
              setBoot(b);
              setSettingsDirty(false);
              setNotice("設定を保存しました");
            }}
          />
        )}
        {notice && <div className="toast" role="status" aria-live="polite">{notice}</div>}
      </main>
    </div>
  );
}
function Home({
  month,
  setMonth,
  create,
  open,
  months,
}: {
  month: string;
  setMonth: (v: string) => void;
  create: () => void;
  open: (month: string) => Promise<void>;
  months: { month: string }[];
}) {
  return (
    <section>
      <h2>ダッシュボード</h2>
      <div className="card">
        <h3>新規シフトを作成</h3>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <button className="primary" onClick={create}>
          条件設定・シフト編集へ
        </button>
      </div>
      <h3>作成済みシフト</h3>
      {months.length ? (
        <ul>
          {months.map((x) => (
            <li key={x.month}>
              {x.month} <button onClick={() => void open(x.month)}>開く</button>
            </li>
          ))}
        </ul>
      ) : (
        <p>まだシフトはありません。</p>
      )}
    </section>
  );
}
function Conditions({
  data,
  month,
  setData,
  notify,
  onSaved,
}: {
  data: MonthData;
  month: string;
  setData: (d: MonthData) => void;
  notify: (s: string) => void;
  onSaved: (d: MonthData) => void;
}) {
  const days = useMemo(() => daysInMonth(month), [month]);
  const workTypes = data.shiftTypes.filter((t) => t.countsAsWork && !t.deletedAt);
  const [shiftTypeId, setShiftTypeId] = useState<number | undefined>(
    workTypes[0]?.id,
  );
  const activeRoles = data.roles;
  const req = new Map(
    data.roleRequirements.map((x) => [
      `${x.targetDate}/${x.shiftTypeId}/${x.roleId}`,
      x,
    ]),
  );
  const setReq = (date: string, roleId: number, value: string) => {
    if (!shiftTypeId) return;
    const requiredCount = Math.max(0, Number(value) || 0);
    const roleRequirements = [
      ...data.roleRequirements.filter(
        (r) =>
          !(
            r.targetDate === date &&
            r.shiftTypeId === shiftTypeId &&
            r.roleId === roleId
          ),
      ),
      { targetDate: date, shiftTypeId, roleId, requiredCount },
    ];
    setData({ ...data, roleRequirements });
  };
  const toggleHoliday = (staffId: number, date: string) => {
    const cells = data.cells.map((c) =>
      c.staffId === staffId && c.targetDate === date
        ? {
            ...c,
            isRequestHoliday: c.isRequestHoliday ? 0 : 1,
            shiftTypeId: c.isRequestHoliday ? c.shiftTypeId : null,
          }
        : c,
    );
    setData({ ...data, cells });
  };
  const save = async () => {
    try {
      await window.shiftApi.saveConditions({
        roleRequirements: data.roleRequirements,
        changes: data.cells.map((c) => ({
          targetDate: c.targetDate,
          staffId: c.staffId,
          shiftTypeId: c.shiftTypeId,
          isRequestHoliday: c.isRequestHoliday,
        })),
      });
      onSaved(data);
      notify("条件を保存しました");
    } catch {
      notify("条件を保存できませんでした。入力内容を確認して、もう一度お試しください。");
    }
  };
  return (
    <section className="conditions">
      <div className="toolbar">
        <div>
          <h2>{month} 条件設定</h2>
          <span>希望休と、日付・勤務種別・職種ごとの必要人数を設定します。</span>
        </div>
        <button className="primary" onClick={save}>
          条件を保存
        </button>
      </div>
      <h3>希望休</h3>
      <div className="grid-wrap">
        <table>
          <thead>
            <tr>
              <th>氏名</th>
              {days.map((d) => (
                <th key={d}>{Number(d.slice(-2))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.staff.map((s) => (
              <tr key={s.id}>
                <td className="name">{s.name}</td>
                {days.map((d) => {
                  const c = data.cells.find(
                    (x) => x.staffId === s.id && x.targetDate === d,
                  );
                  return (
                    <td key={d}>
                      <button
                        className={c?.isRequestHoliday ? "holiday" : ""}
                        onClick={() => toggleHoliday(s.id, d)}
                      >
                        {c?.isRequestHoliday ? "希望休" : "－"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>日別必要人数（職種別）</h3>
      <div className="form-row">
        <label>
          勤務種別
          <select
            value={shiftTypeId}
            onChange={(e) => setShiftTypeId(Number(e.target.value))}
          >
            {workTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!activeRoles.length && (
        <p>先に「マスタ・ルール設定」で職種を登録してください。</p>
      )}
      <div className="grid-wrap">
        <table>
          <thead>
            <tr>
              <th>職種</th>
              {days.map((d) => (
                <th key={d}>{Number(d.slice(-2))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeRoles.map((role) => (
              <tr key={role.id}>
                <td className="name">{role.name}</td>
                {days.map((d) => (
                  <td key={d}>
                    <input
                      className="count"
                      type="number"
                      min="0"
                      value={
                        shiftTypeId
                          ? (req.get(`${d}/${shiftTypeId}/${role.id}`)
                              ?.requiredCount ?? 0)
                          : 0
                      }
                      onChange={(e) => setReq(d, role.id, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
const ROW_HEIGHT = 34;
const COL_WIDTH = 52;
const NAME_COL_WIDTH = 160;
const ROLE_COL_WIDTH = 96;

type CellProps = {
  staff: Staff[];
  days: string[];
  shiftTypes: ShiftType[];
  cellsByKey: Map<string, Cell>;
  pendingKeys: Set<string>;
  violationKeys: Set<string>;
  focused: { row: number; col: number };
  editing: boolean;
  onFocusCell: (row: number, col: number) => void;
  onChange: (staffId: number, date: string, value: string) => void;
  onExitEdit: () => void;
};

function ShiftCell({
  columnIndex,
  rowIndex,
  style,
  ariaAttributes,
  staff,
  days,
  shiftTypes,
  cellsByKey,
  pendingKeys,
  violationKeys,
  focused,
  editing,
  onFocusCell,
  onChange,
  onExitEdit,
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  ariaAttributes: { "aria-colindex": number; role: "gridcell" };
} & CellProps) {
  const s = staff[rowIndex];
  const date = days[columnIndex];
  const key = `${s.id}/${date}`;
  const cell = cellsByKey.get(key);
  const type = shiftTypes.find((t) => t.id === cell?.shiftTypeId);
  const isFocused = focused.row === rowIndex && focused.col === columnIndex;
  const isPending = pendingKeys.has(key);
  const isViolation = violationKeys.has(key);
  return (
    <div
      {...ariaAttributes}
      aria-rowindex={rowIndex + 1}
      aria-describedby={`shift-row-${s.id} shift-column-${date}`}
      aria-label={`${s.name} ${date} ${type?.name ?? "未設定"}`}
      tabIndex={isFocused ? 0 : -1}
      data-cell={`${rowIndex}-${columnIndex}`}
      className={`shift-cell${isPending ? " pending" : ""}${isViolation ? " violation" : ""}${isFocused ? " focused" : ""}`}
      style={{ ...style, backgroundColor: type?.colorCode }}
      onClick={() => onFocusCell(rowIndex, columnIndex)}
      onDoubleClick={() => onFocusCell(rowIndex, columnIndex)}
    >
      {isFocused && editing ? (
        <select
          autoFocus
          aria-label={`${s.name} ${date}`}
          value={cell?.shiftTypeId ?? ""}
          onChange={(e) => {
            onChange(s.id, date, e.target.value);
            onExitEdit();
          }}
          onBlur={onExitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onExitEdit();
            }
          }}
        >
          <option value="">―</option>
          {shiftTypes.filter((t) => !t.deletedAt).map((t) => (
            <option key={t.id} value={t.id}>
              {t.shortName}
            </option>
          ))}
        </select>
      ) : (
        <span>{type?.shortName ?? "―"}</span>
      )}
    </div>
  );
}

function ShiftGrid({
  staff,
  days,
  shiftTypes,
  cellsByKey,
  pendingKeys,
  violationKeys,
  onChange,
  jumpRequest,
  onJumpDone,
}: {
  staff: Staff[];
  days: string[];
  shiftTypes: ShiftType[];
  cellsByKey: Map<string, Cell>;
  pendingKeys: Set<string>;
  violationKeys: Set<string>;
  onChange: (staffId: number, date: string, value: string) => void;
  jumpRequest: { row: number; col: number } | null;
  onJumpDone: () => void;
}) {
  const gridRef = useGridRef(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const nameListRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState({ row: 0, col: 0 });
  const [editing, setEditing] = useState(false);
  const clipboard = useRef<number | null>(null);

  const moveFocus = useCallback(
    (row: number, col: number) => {
      const r = Math.max(0, Math.min(staff.length - 1, row));
      const c = Math.max(0, Math.min(days.length - 1, col));
      setFocused({ row: r, col: c });
      setEditing(false);
      gridRef.current?.scrollToCell({ rowIndex: r, columnIndex: c, rowAlign: "smart", columnAlign: "smart" });
      requestAnimationFrame(() => {
        const el = gridRef.current?.element?.querySelector(
          `[data-cell="${r}-${c}"]`,
        ) as HTMLElement | null;
        el?.focus();
      });
    },
    [staff.length, days.length, gridRef],
  );

  useEffect(() => {
    if (jumpRequest) {
      moveFocus(jumpRequest.row, jumpRequest.col);
      onJumpDone();
    }
  }, [jumpRequest]);

  useEffect(() => {
    const el = gridRef.current?.element;
    if (!el) return;
    const onScroll = () => {
      if (nameListRef.current) nameListRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
      if (headerRef.current) headerRef.current.style.transform = `translateX(${-el.scrollLeft}px)`;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [gridRef.current?.element]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(focused.row - 1, focused.col); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(focused.row + 1, focused.col); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); moveFocus(focused.row, focused.col - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); moveFocus(focused.row, focused.col + 1); }
    else if (e.key === "Enter") { e.preventDefault(); setEditing(true); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      const s = staff[focused.row];
      const cell = cellsByKey.get(`${s.id}/${days[focused.col]}`);
      clipboard.current = cell?.shiftTypeId ?? null;
    } else if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      const s = staff[focused.row];
      onChange(s.id, days[focused.col], clipboard.current ? String(clipboard.current) : "");
    }
  };

  const cellProps: CellProps = {
    staff,
    days,
    shiftTypes,
    cellsByKey,
    pendingKeys,
    violationKeys,
    focused,
    editing,
    onFocusCell: (row, col) => moveFocus(row, col),
    onChange,
    onExitEdit: () => setEditing(false),
  };

  return (
    <div className="shift-grid-wrap" onKeyDown={onKeyDown}>
      <div className="shift-grid-header-row">
        <div className="shift-grid-corner" role="columnheader" style={{ width: NAME_COL_WIDTH + ROLE_COL_WIDTH }}>
          氏名／職種
        </div>
        <div className="shift-grid-header-clip" style={{ width: days.length * COL_WIDTH }}>
          <div ref={headerRef} className="shift-grid-header-inner">
            {days.map((d) => (
              <div
                key={d}
                id={`shift-column-${d}`}
                role="columnheader"
                aria-colindex={days.indexOf(d) + 1}
                className="shift-grid-header-cell"
                style={{ width: COL_WIDTH }}
              >
                <small>{Number(d.slice(-2))}</small>
                <br />
                <em>{WEEKDAY_LABELS[new Date(`${d}T00:00:00`).getDay()]}</em>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="shift-grid-body-row">
        <div className="shift-grid-name-clip" style={{ width: NAME_COL_WIDTH + ROLE_COL_WIDTH }}>
          <div ref={nameListRef} className="shift-grid-name-inner">
            {staff.map((s) => (
              <div
                key={s.id}
                id={`shift-row-${s.id}`}
                role="rowheader"
                aria-rowindex={staff.indexOf(s) + 1}
                className="shift-grid-name-cell"
                style={{ height: ROW_HEIGHT }}
              >
                <span className="name" style={{ width: NAME_COL_WIDTH }}>{s.name}</span>
                <span style={{ width: ROLE_COL_WIDTH }}>{s.roleName}</span>
              </div>
            ))}
          </div>
        </div>
        <p id="shift-grid-instructions" className="sr-only">
          矢印キーでセルを移動し、Enterで勤務種別を選択します。Escで選択を取り消し、Ctrl+CとCtrl+Vで勤務種別をコピー・貼り付けできます。
        </p>
        <div
          ref={outerRef}
          role="grid"
          aria-label="勤務表"
          aria-describedby="shift-grid-instructions"
          aria-rowcount={staff.length}
          aria-colcount={days.length}
        >
          <Grid
            gridRef={gridRef}
            cellComponent={ShiftCell}
            cellProps={cellProps}
            columnCount={days.length}
            columnWidth={COL_WIDTH}
            rowCount={staff.length}
            rowHeight={ROW_HEIGHT}
            style={{ height: Math.min(staff.length * ROW_HEIGHT, 560), width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function Editor({
  data,
  setData,
  month,
  notify,
  onSaved,
  hasUnsavedChanges,
}: {
  data: MonthData;
  setData: (d: MonthData) => void;
  month: string;
  notify: (s: string) => void;
  onSaved: (d: MonthData) => void;
  hasUnsavedChanges: boolean;
}) {
  const [pending, setPending] = useState<Cell[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [job, setJob] = useState<{ id: number; assigned: number; total: number } | null>(
    null,
  );
  const [jumpRequest, setJumpRequest] = useState<{ row: number; col: number } | null>(null);
  const days = useMemo(() => daysInMonth(month), [month]);
  const byKey = new Map(
    data.cells.map((c) => [`${c.staffId}/${c.targetDate}`, c]),
  );
  const pendingKeys = useMemo(
    () => new Set(pending.map((c) => `${c.staffId}/${c.targetDate}`)),
    [pending],
  );
  const violationKeys = useMemo(
    () =>
      new Set(
        violations
          .filter((v) => v.staffId != null)
          .map((v) => `${v.staffId}/${v.targetDate}`),
      ),
    [violations],
  );
  const change = (staffId: number, date: string, value: string) => {
    const c = {
      targetDate: date,
      staffId,
      shiftTypeId: value ? Number(value) : null,
      isRequestHoliday: 0,
    };
    const cells = data.cells.map((x) =>
      x.staffId === staffId && x.targetDate === date ? c : x,
    );
    setData({ ...data, cells });
    setPending((p) => [
      ...p.filter((x) => x.staffId !== staffId || x.targetDate !== date),
      c,
    ]);
  };
  const save = async () => {
    if (!pending.length) return;
    try {
      await window.shiftApi.updateCells({ changes: pending });
      setPending([]);
      onSaved(data);
      notify("変更を保存しました");
    } catch {
      notify("変更を保存できませんでした。入力内容を確認して、もう一度お試しください。");
    }
  };
  const exportXlsx = async () => {
    if (hasUnsavedChanges) {
      notify("未保存の変更があります。Excel出力の前に保存してください。");
      return;
    }
    try {
      const r = await window.shiftApi.exportXlsx(month);
      if (r.filePath) notify("Excelを出力しました");
    } catch {
      notify("Excelを出力できませんでした。保存先とアクセス権限を確認してください。");
    }
  };
  useEffect(() => {
    window.shiftApi.onExportRequested(exportXlsx);
  }, [month]);
  useEffect(() => {
    const offProgress = window.shiftApi.onGenerateProgress((p) => {
      setJob((cur) => (cur && cur.id === p.jobId ? { ...cur, assigned: p.assigned, total: p.total } : cur));
    });
    const offDone = window.shiftApi.onGenerateDone((result) => {
      setJob((cur) => (cur && cur.id === result.jobId ? null : cur));
      onSaved(result);
      setViolations(result.violations);
      notify(
        result.timedOut
          ? `180秒の制限に達しました。未割当・要確認が${result.violations.length}件あります`
          : result.violations.length
            ? `未割当・要確認が${result.violations.length}件あります`
            : "シフトを自動生成しました",
      );
    });
    const offError = window.shiftApi.onGenerateError((e) => {
      setJob((cur) => (cur && cur.id === e.jobId ? null : cur));
      notify(`自動生成でエラーが発生しました: ${e.message}`);
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, []);
  // セル変更後500ms以内に違反を再検証する（PRODUCT_SPEC 4.3）
  useEffect(() => {
    if (!pending.length) return;
    const timer = setTimeout(async () => {
      const result = (await window.shiftApi.validate(month, data.cells)) as Violation[];
      setViolations(result);
    }, 500);
    return () => clearTimeout(timer);
  }, [pending, data.cells, month]);
  const startGenerate = async () => {
    if (hasUnsavedChanges) {
      notify("未保存の変更があります。自動生成の前に保存してください。");
      return;
    }
    try {
      const jobId = await window.shiftApi.generateStart(month);
      setJob({ id: jobId, assigned: 0, total: 0 });
    } catch {
      notify("自動生成を開始できませんでした。条件設定を確認してください。");
    }
  };
  const cancelGenerate = async () => {
    if (job) await window.shiftApi.generateCancel(job.id);
  };
  const jumpToViolation = (v: Violation) => {
    if (v.staffId == null) return;
    const row = data.staff.findIndex((s) => s.id === v.staffId);
    const col = days.indexOf(v.targetDate);
    if (row >= 0 && col >= 0) setJumpRequest({ row, col });
  };
  return (
    <section className="editor">
      <div className="toolbar">
        <div>
          <h2>{month} シフト編集</h2>
          <span>{pending.length ? "未保存の変更があります" : "保存済み"}</span>
        </div>
        <div>
          {job ? (
            <>
              <span className="progress">
                自動生成中… {job.total ? `${job.assigned}/${job.total}` : `${job.assigned}件`}
              </span>
              <button onClick={cancelGenerate}>中止</button>
            </>
          ) : (
            <button onClick={startGenerate}>自動生成</button>
          )}
          <button onClick={save}>変更を保存</button>
          <button className="primary" onClick={exportXlsx}>
            Excelへ出力
          </button>
        </div>
      </div>
      {violations.length > 0 && (
        <div className="alert">
          <strong>未割当・要確認</strong>
          {violations.map((v, i) =>
            v.staffId != null ? (
              <button key={i} className="violation-link" onClick={() => jumpToViolation(v)}>
                {v.targetDate}: {v.message}
              </button>
            ) : (
              <div key={i}>{v.targetDate}: {v.message}</div>
            ),
          )}
        </div>
      )}
      <ShiftGrid
        staff={data.staff}
        days={days}
        shiftTypes={data.shiftTypes}
        cellsByKey={byKey}
        pendingKeys={pendingKeys}
        violationKeys={violationKeys}
        onChange={change}
        jumpRequest={jumpRequest}
        onJumpDone={() => setJumpRequest(null)}
      />
    </section>
  );
}
function RolesPanel({ staff, onChanged }: { staff: Staff[]; onChanged: () => Promise<void> }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const reload = async () => setRoles(await window.shiftApi.listRoles(true));
  useEffect(() => {
    reload();
  }, []);
  const remove = async (role: Role) => {
    const [staffUsage, requirementUsage] = await Promise.all([
      window.shiftApi.roleUsage(role.id),
      window.shiftApi.roleRequirementUsage(role.id),
    ]);
    if (staffUsage > 0 || requirementUsage > 0) {
      const lines = [
        staffUsage > 0 ? `職員${staffUsage}名の職種表示が空欄になります。` : "",
        requirementUsage > 0
          ? `この職種の必要人数設定（${requirementUsage}件）は残りますが、対象職員がいなくなるため充足できなくなります。`
          : "",
      ].filter(Boolean);
      if (!confirm(`論理削除すると以下に影響します。\n${lines.join("\n")}\n削除しますか？`))
        return;
    }
    await window.shiftApi.setRoleDeleted(role.id, true);
    reload();
    await onChanged();
  };
  return (
    <div className="settings">
      <div>
        <h3>職種マスタ</h3>
        <div className="form-row">
          <input
            value={name}
            placeholder="例：介護職"
            aria-label="追加する職種名"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={async () => {
              if (!name.trim()) return;
              await window.shiftApi.saveRole({ name });
              setName("");
              reload();
              await onChanged();
            }}
          >
            追加
          </button>
        </div>
        {roles.map((role) => (
          <div className="form-row" key={role.id}>
            <input
              defaultValue={role.name}
              aria-label={`${role.name}の職種名`}
              onBlur={async (e) => {
                await window.shiftApi.saveRole({ id: role.id, name: e.target.value });
                reload();
                await onChanged();
              }}
            />
            <input
              type="number"
              min="0"
              defaultValue={role.displayOrder}
              aria-label={`${role.name}の表示順`}
              onBlur={async (e) => {
                await window.shiftApi.saveRole({
                  id: role.id,
                  name: role.name,
                  displayOrder: Number(e.target.value),
                });
                reload();
                await onChanged();
              }}
            />
            <span>
              {role.deletedAt ? "削除済み" : "有効"}（
              {staff.filter((s) => s.roleId === role.id).length}名）
            </span>
            <button
              onClick={async () => {
                if (role.deletedAt) {
                  await window.shiftApi.setRoleDeleted(role.id, false);
                  reload();
                  await onChanged();
                } else remove(role);
              }}
            >
              {role.deletedAt ? "復元" : "削除"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffLifecyclePanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<Staff[]>([]);
  const reload = async () => setItems(await window.shiftApi.listStaff());
  useEffect(() => {
    reload();
  }, []);
  return (
    <div className="settings">
      <div>
        <h3>職員の削除・復元</h3>
        <p>削除しても過去の勤務表は保持されます。</p>
        {items.map((item) => (
          <div className="form-row" key={item.id}>
            <span>
              {item.name}（{item.roleName || "職種未設定"}）
            </span>
            <button
              onClick={async () => {
                if (!item.deletedAt) {
                  const usage = await window.shiftApi.staffUsage(item.id);
                  const impacts = [
                    usage.shifts ? `勤務セル ${usage.shifts}件は履歴として保持されます。` : "",
                    usage.ngPairs ? `NGペア ${usage.ngPairs}件は生成対象から外れます。` : "",
                    usage.unavailableConditions ? `勤務不可条件 ${usage.unavailableConditions}件は保持されます。` : "",
                  ].filter(Boolean);
                  if (
                    !confirm(
                      `職員「${item.name}」を論理削除します。\n${impacts.join("\n") || "現在の利用はありません。"}\n削除しますか？`,
                    )
                  )
                    return;
                }
                await window.shiftApi.setStaffDeleted(item.id, !item.deletedAt);
                reload();
                await onChanged();
              }}
            >
              {item.deletedAt ? "復元" : "削除"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftTypeLifecyclePanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<ShiftType[]>([]);
  const reload = async () => setItems(await window.shiftApi.listShiftTypes());
  useEffect(() => {
    reload();
  }, []);
  const toggleDeleted = async (item: ShiftType) => {
    if (!item.deletedAt) {
      const usage = await window.shiftApi.shiftTypeUsage(item.id);
      const impacts = [
        usage.shifts ? `過去の勤務セル ${usage.shifts}件は履歴として保持されます。` : "",
        usage.requirements
          ? `必要人数設定 ${usage.requirements}件は新規生成では使われなくなります。`
          : "",
        usage.sequenceRules ? `翌日ルール ${usage.sequenceRules}件を見直してください。` : "",
      ].filter(Boolean);
      if (
        !confirm(
          `勤務種別「${item.name}」を論理削除します。\n${impacts.join("\n") || "現在の利用はありません。"}\n削除しますか？`,
        )
      )
        return;
    }
    await window.shiftApi.setShiftTypeDeleted(item.id, !item.deletedAt);
    await reload();
    await onChanged();
  };
  return (
    <div className="settings">
      <div>
        <h3>勤務種別の削除・復元</h3>
        <p>削除しても過去の勤務表は保持されます。</p>
        {items.map((item) => (
          <div className="form-row" key={item.id}>
            <span>
              {item.name}（{item.shortName}）{item.deletedAt ? "削除済み" : "有効"}
            </span>
            <button
              onClick={async () => {
                await toggleDeleted(item);
              }}
            >
              {item.deletedAt ? "復元" : "削除"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UnavailablePanel({
  staff,
  shiftTypes,
  conditions,
  setConditions,
}: {
  staff: Staff[];
  shiftTypes: ShiftType[];
  conditions: UnavailableCondition[];
  setConditions: (c: UnavailableCondition[]) => void;
}) {
  const toggleWeekday = (staffId: number, weekday: number) => {
    const exists = conditions.some(
      (c) =>
        c.staffId === staffId && c.conditionType === "WEEKDAY" && c.value === weekday,
    );
    setConditions(
      exists
        ? conditions.filter(
            (c) =>
              !(
                c.staffId === staffId &&
                c.conditionType === "WEEKDAY" &&
                c.value === weekday
              ),
          )
        : [...conditions, { staffId, conditionType: "WEEKDAY", value: weekday }],
    );
  };
  const toggleShiftType = (staffId: number, shiftTypeId: number) => {
    const exists = conditions.some(
      (c) =>
        c.staffId === staffId &&
        c.conditionType === "SHIFT_TYPE" &&
        c.value === shiftTypeId,
    );
    setConditions(
      exists
        ? conditions.filter(
            (c) =>
              !(
                c.staffId === staffId &&
                c.conditionType === "SHIFT_TYPE" &&
                c.value === shiftTypeId
              ),
          )
        : [
            ...conditions,
            { staffId, conditionType: "SHIFT_TYPE", value: shiftTypeId },
          ],
    );
  };
  return (
    <div className="settings">
      <div>
        <h3>勤務不可曜日・勤務不可種別</h3>
        {staff.map((s) => (
          <div className="form-row" key={s.id}>
            <span className="name">{s.name}</span>
            <span>
              {WEEKDAY_LABELS.map((label, weekday) => (
                <label key={weekday}>
                  <input
                    type="checkbox"
                    checked={conditions.some(
                      (c) =>
                        c.staffId === s.id &&
                        c.conditionType === "WEEKDAY" &&
                        c.value === weekday,
                    )}
                    onChange={() => toggleWeekday(s.id, weekday)}
                  />
                  {label}
                </label>
              ))}
            </span>
            <span>
              {shiftTypes.map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={conditions.some(
                      (c) =>
                        c.staffId === s.id &&
                        c.conditionType === "SHIFT_TYPE" &&
                        c.value === t.id,
                    )}
                    onChange={() => toggleShiftType(s.id, t.id)}
                  />
                  {t.shortName}
                </label>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Settings({
  boot,
  onSaved,
  onMasterChanged,
  onDirty,
  onError,
}: {
  boot: Boot;
  onSaved: (b: Boot) => void;
  onMasterChanged: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onError: (message: string) => void;
}) {
  const [staff, setStaff] = useState(boot.staff);
  const [types, setTypes] = useState(boot.shiftTypes);
  const [ngPairs, setNgPairs] = useState(boot.ngPairs);
  const [sequenceRules, setSequenceRules] = useState(boot.sequenceRules);
  const [unavailableConditions, setUnavailableConditions] = useState(
    boot.unavailableConditions,
  );
  const [roles, setRoles] = useState<Role[]>([]);
  const initialSettings = useRef("");
  const settingState = () =>
    JSON.stringify({ staff, types, ngPairs, sequenceRules, unavailableConditions });
  if (!initialSettings.current) initialSettings.current = settingState();
  useEffect(() => {
    window.shiftApi.listRoles().then(setRoles);
  }, [boot]);
  useEffect(() => {
    onDirty(settingState() !== initialSettings.current);
  }, [staff, types, ngPairs, sequenceRules, unavailableConditions, onDirty]);
  const save = async () => {
    try {
      const updated = await window.shiftApi.saveConfiguration({
        staff,
        shiftTypes: types,
        ngPairs,
        sequenceRules,
        unavailableConditions,
      });
      initialSettings.current = settingState();
      onDirty(false);
      onSaved(updated);
    } catch {
      onError("設定を保存できませんでした。入力内容と他の設定との整合性を確認してください。");
    }
  };
  const selectStaff = (value: string) => Number(value);
  return (
    <section>
      <h2>マスタ・ルール設定</h2>
      <p>ここで設定した内容はすべてこのPC内に保存されます。</p>
      <RolesPanel staff={staff} onChanged={onMasterChanged} />
      <StaffLifecyclePanel onChanged={onMasterChanged} />
      <ShiftTypeLifecyclePanel onChanged={onMasterChanged} />
      <div className="settings">
        <div>
          <h3>職員マスタ</h3>
          {staff.map((s, i) => (
            <div className="form-row" key={i}>
              <input
                value={s.name}
                placeholder="氏名"
                aria-label="職員氏名"
                onChange={(e) =>
                  setStaff(
                    staff.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
              <select
                value={s.roleId ?? ""}
                aria-label="主職種"
                onChange={(e) =>
                  setStaff(
                    staff.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            roleId: e.target.value ? Number(e.target.value) : null,
                          }
                        : x,
                    ),
                  )
                }
              >
                <option value="">職種未設定</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                value={s.employmentType}
                placeholder="雇用区分"
                aria-label="雇用区分"
                onChange={(e) =>
                  setStaff(
                    staff.map((x, j) =>
                      j === i ? { ...x, employmentType: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                type="number"
                placeholder="下限日数"
                aria-label="月間勤務日数下限"
                value={s.minDays ?? ""}
                onChange={(e) =>
                  setStaff(
                    staff.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            minDays: e.target.value ? Number(e.target.value) : null,
                          }
                        : x,
                    ),
                  )
                }
              />
              <input
                type="number"
                placeholder="上限日数"
                aria-label="月間勤務日数上限"
                value={s.maxDays ?? ""}
                onChange={(e) =>
                  setStaff(
                    staff.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            maxDays: e.target.value ? Number(e.target.value) : null,
                          }
                        : x,
                    ),
                  )
                }
              />
            </div>
          ))}
          <button
            onClick={() =>
              setStaff([
                ...staff,
                {
                  id: -Date.now() - staff.length,
                  name: "",
                  roleId: null,
                  roleName: "",
                  employmentType: "full",
                  minDays: null,
                  maxDays: null,
                },
              ])
            }
          >
            職員を追加
          </button>
        </div>
        <div>
          <h3>勤務種別</h3>
          {types.map((t, i) => (
            <div className="form-row" key={i}>
              <input
                value={t.name}
                placeholder="名称"
                aria-label="勤務種別名称"
                onChange={(e) =>
                  setTypes(
                    types.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                value={t.shortName}
                placeholder="表示"
                aria-label="勤務種別略称"
                onChange={(e) =>
                  setTypes(
                    types.map((x, j) =>
                      j === i ? { ...x, shortName: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                type="color"
                value={t.colorCode}
                aria-label="勤務種別の色"
                onChange={(e) =>
                  setTypes(
                    types.map((x, j) =>
                      j === i ? { ...x, colorCode: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                type="time"
                value={t.startTime ?? ""}
                aria-label="開始時刻"
                onChange={(e) =>
                  setTypes(
                    types.map((x, j) =>
                      j === i ? { ...x, startTime: e.target.value || null } : x,
                    ),
                  )
                }
              />
              <input
                type="time"
                value={t.endTime ?? ""}
                aria-label="終了時刻"
                onChange={(e) =>
                  setTypes(
                    types.map((x, j) =>
                      j === i ? { ...x, endTime: e.target.value || null } : x,
                    ),
                  )
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(t.countsAsWork)}
                  onChange={(e) =>
                    setTypes(
                      types.map((x, j) =>
                        j === i ? { ...x, countsAsWork: e.target.checked ? 1 : 0 } : x,
                      ),
                    )
                  }
                />
                勤務日として数える
              </label>
            </div>
          ))}
          <button
            onClick={() =>
              setTypes([
                ...types,
                {
                  id: -Date.now() - types.length,
                  name: "勤務",
                  shortName: "勤",
                  colorCode: "#ffffff",
                  startTime: null,
                  endTime: null,
                  countsAsWork: 1,
                },
              ])
            }
          >
            勤務種別を追加
          </button>
        </div>
      </div>
      <div className="settings">
        <div>
          <h3>同日勤務NGペア</h3>
          {ngPairs.map((p, i) => (
            <div className="form-row" key={i}>
              <select
                value={p.staffId1}
                aria-label="NGペアの一人目"
                onChange={(e) =>
                  setNgPairs(
                    ngPairs.map((x, j) =>
                      j === i
                        ? { ...x, staffId1: selectStaff(e.target.value) }
                        : x,
                    ),
                  )
                }
              >
                {staff.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span>と</span>
              <select
                value={p.staffId2}
                aria-label="NGペアの二人目"
                onChange={(e) =>
                  setNgPairs(
                    ngPairs.map((x, j) =>
                      j === i
                        ? { ...x, staffId2: selectStaff(e.target.value) }
                        : x,
                    ),
                  )
                }
              >
                {staff.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="このNGペアを削除"
                onClick={() => setNgPairs(ngPairs.filter((_, j) => j !== i))}
              >
                削除
              </button>
            </div>
          ))}
          <button
            disabled={staff.length < 2}
            onClick={() =>
              setNgPairs([
                ...ngPairs,
                { staffId1: staff[0].id, staffId2: staff[1].id },
              ])
            }
          >
            NGペアを追加
          </button>
        </div>
        <div>
          <h3>連続勤務ルール</h3>
          {sequenceRules.map((r, i) => (
            <div className="form-row" key={i}>
              <select
                value={r.firstShiftTypeId}
                aria-label="前日の勤務種別"
                onChange={(e) =>
                  setSequenceRules(
                    sequenceRules.map((x, j) =>
                      j === i
                        ? { ...x, firstShiftTypeId: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              >
                {types.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span>の翌日は</span>
              <select
                value={r.secondShiftTypeId}
                aria-label="翌日の勤務種別"
                onChange={(e) =>
                  setSequenceRules(
                    sequenceRules.map((x, j) =>
                      j === i
                        ? { ...x, secondShiftTypeId: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              >
                {types.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="この翌日ルールを削除"
                onClick={() =>
                  setSequenceRules(sequenceRules.filter((_, j) => j !== i))
                }
              >
                削除
              </button>
            </div>
          ))}
          <button
            disabled={types.length < 2}
            onClick={() =>
              setSequenceRules([
                ...sequenceRules,
                {
                  firstShiftTypeId: types[0].id,
                  secondShiftTypeId: types[1].id,
                },
              ])
            }
          >
            ルールを追加
          </button>
        </div>
      </div>
      <UnavailablePanel
        staff={staff}
        shiftTypes={types}
        conditions={unavailableConditions}
        setConditions={setUnavailableConditions}
      />
      <button className="primary" onClick={save}>
        設定を保存
      </button>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
