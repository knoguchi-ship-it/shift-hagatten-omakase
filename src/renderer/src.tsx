import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Grid, useGridRef } from "react-window";
import "./style.css";
import type {
  Boot,
  Cell,
  MonthData,
  MonthlyConstraints,
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
  const create = async (nextPage: "conditions" | "edit" = "edit") => {
    const d = await window.shiftApi.createMonth(month);
    setData(d);
    setSavedData(d);
    setActiveMonth(month);
    setMonthDirty(false);
    setBoot(d);
    setPage(nextPage);
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
      await create(next === "conditions" ? "conditions" : "edit");
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
        <div className="app-brand">
          <p>介護施設向け勤務表</p>
          <h1>シフトはがってん<br />おまかせ！</h1>
        </div>
        <nav className="primary-navigation" aria-label="主な画面">
          <button
            className={page === "home" ? "active" : ""}
            onClick={() => void navigate("home")}
          >
            <span>01</span> 月を選ぶ
          </button>
          <button
            className={page === "conditions" ? "active" : ""}
            onClick={() => void navigate("conditions")}
          >
            <span>02</span> 条件を設定
          </button>
          <button
            className={page === "edit" ? "active" : ""}
            onClick={() => void navigate("edit")}
          >
            <span>03</span> 確認・編集
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => void navigate("settings")}
          >
            <span>管理</span> マスタ・制約
          </button>
        </nav>
        <p className="navigation-help">月ごとの作業は、上から順に進めます。</p>
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
            onOpenEditor={() => setPage("edit")}
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
  create: (nextPage?: "conditions" | "edit") => void;
  open: (month: string) => Promise<void>;
  months: { month: string }[];
}) {
  return (
    <section className="page-shell">
      <header className="page-header">
        <p className="eyebrow">月次勤務表</p>
        <h2>勤務表を作成・再開する</h2>
        <p>対象月を選び、希望休と必要人数を設定してから自動生成・編集へ進みます。</p>
      </header>
      <div className="dashboard-grid">
        <section className="card action-card" aria-labelledby="new-month-heading">
          <p className="step-badge">はじめに</p>
          <h3 id="new-month-heading">新しい月を作成</h3>
          <label className="field-label" htmlFor="new-month">対象月</label>
          <input
            id="new-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <p className="field-help">勤務表の枠を作成します。作成後、希望休と必要人数の設定画面を開きます。</p>
          <button className="primary" onClick={() => create("conditions")}>
            この月を作成して条件を設定
          </button>
        </section>
        <section className="card" aria-labelledby="existing-month-heading">
          <p className="step-badge muted">続きから</p>
          <h3 id="existing-month-heading">作成済みの月を開く</h3>
          {months.length ? (
            <ul className="month-list">
              {months.map((x) => (
                <li key={x.month}>
                  <strong>{x.month.replace("-", "年")}月</strong>
                  <button onClick={() => void open(x.month)}>開く</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">まだ作成済みの勤務表はありません。</p>
          )}
        </section>
      </div>
    </section>
  );
}
function Conditions({
  data,
  month,
  setData,
  notify,
  onSaved,
  onOpenEditor,
}: {
  data: MonthData;
  month: string;
  setData: (d: MonthData) => void;
  notify: (s: string) => void;
  onSaved: (d: MonthData) => void;
  onOpenEditor: () => void;
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
        monthlyConstraints: data.monthlyConstraints,
      });
      onSaved(data);
      notify("条件を保存しました");
      return true;
    } catch {
      notify("条件を保存できませんでした。入力内容を確認して、もう一度お試しください。");
      return false;
    }
  };
  return (
    <section className="page-shell conditions">
      <header className="page-header page-header-with-action">
        <div>
          <p className="eyebrow">手順 2 / 3</p>
          <h2>{month.replace("-", "年")}月の条件を設定</h2>
          <p>自動生成の前に、希望休と必要人数を設定します。ここで保存してから「シフト編集」へ進みます。</p>
        </div>
        <button onClick={() => void save()}>
          下書きを保存
        </button>
        <button
          className="primary"
          onClick={async () => {
            if (await save()) onOpenEditor();
          }}
        >
          保存してシフト編集へ
        </button>
      </header>
      <section className="condition-card" aria-labelledby="holiday-heading">
      <div className="section-heading"><div><p className="step-badge">条件 1</p><h3 id="holiday-heading">希望休</h3><p>希望休にする日をクリックしてください。もう一度クリックすると解除できます。</p></div></div>
      <div className="grid-wrap">
        <table>
          <thead>
            <tr>
              <th>氏名</th>
              {days.map((d) => (
                <th key={d}><small>{Number(d.slice(-2))}</small><br /><em>{WEEKDAY_LABELS[new Date(`${d}T00:00:00`).getDay()]}</em></th>
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
      </section>
      <section className="condition-card" aria-labelledby="requirement-heading">
      <div className="section-heading"><div><p className="step-badge">条件 2</p><h3 id="requirement-heading">日別の必要人数</h3><p>勤務種別と職種ごとに、その日に必要な人数を入力します。</p></div></div>
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
                <th key={d}><small>{Number(d.slice(-2))}</small><br /><em>{WEEKDAY_LABELS[new Date(`${d}T00:00:00`).getDay()]}</em></th>
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
      <MonthlyConstraintsPanel data={data} setData={setData} />
    </section>
  );
}

function MonthlyConstraintsPanel({
  data,
  setData,
}: {
  data: MonthData;
  setData: (data: MonthData) => void;
}) {
  const monthly = data.monthlyConstraints;
  const update = (change: Partial<MonthlyConstraints>) =>
    setData({ ...data, monthlyConstraints: { ...monthly, ...change } });
  const toggleUnavailable = (staffId: number, conditionType: "WEEKDAY" | "SHIFT_TYPE", value: number) => {
    const exists = monthly.unavailableConditions.some((item) => item.staffId === staffId && item.conditionType === conditionType && item.value === value);
    update({
      unavailableConditions: exists
        ? monthly.unavailableConditions.filter((item) => !(item.staffId === staffId && item.conditionType === conditionType && item.value === value))
        : [...monthly.unavailableConditions, { staffId, conditionType, value }],
    });
  };
  const staffName = (id: number) => data.staff.find((staff) => staff.id === id)?.name || "未入力の職員";
  const typeName = (id: number) => data.shiftTypes.find((type) => type.id === id)?.name || "未入力の勤務種別";
  return (
    <section className="condition-card monthly-constraints" aria-labelledby="monthly-constraints-heading">
      <div className="section-heading"><div><p className="step-badge">条件 3</p><h3 id="monthly-constraints-heading">この月だけの追加制約</h3><p>共通の制約とは別に、この月に限って追加するルールです。ここで追加した内容は他の月には反映されません。</p></div></div>
      <fieldset><legend>この月だけのNGペア</legend><p>同じ日に勤務させない職員の組み合わせです。</p>
        {monthly.ngPairs.map((pair, index) => <div className="rule-row" key={`${pair.staffId1}-${pair.staffId2}-${index}`}><label>職員A<select value={pair.staffId1} onChange={(e) => update({ ngPairs: monthly.ngPairs.map((item, i) => i === index ? { ...item, staffId1: Number(e.target.value) } : item) })}>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label><label>職員B<select value={pair.staffId2} onChange={(e) => update({ ngPairs: monthly.ngPairs.map((item, i) => i === index ? { ...item, staffId2: Number(e.target.value) } : item) })}>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label><button onClick={() => update({ ngPairs: monthly.ngPairs.filter((_, i) => i !== index) })}>{staffName(pair.staffId1)} と {staffName(pair.staffId2)} の設定を削除</button></div>)}
        <button disabled={data.staff.length < 2} onClick={() => update({ ngPairs: [...monthly.ngPairs, { staffId1: data.staff[0].id, staffId2: data.staff[1].id }] })}>この月のNGペアを追加</button>
      </fieldset>
      <fieldset><legend>この月だけの翌日ルール</legend><p>例：研修の翌日は日勤にしない、など、この月だけの勤務種別の連続条件です。</p>
        {monthly.sequenceRules.map((rule, index) => <div className="rule-row" key={`${rule.firstShiftTypeId}-${rule.secondShiftTypeId}-${index}`}><label>前日<select value={rule.firstShiftTypeId} onChange={(e) => update({ sequenceRules: monthly.sequenceRules.map((item, i) => i === index ? { ...item, firstShiftTypeId: Number(e.target.value) } : item) })}>{data.shiftTypes.filter((type) => !type.deletedAt).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label>翌日<select value={rule.secondShiftTypeId} onChange={(e) => update({ sequenceRules: monthly.sequenceRules.map((item, i) => i === index ? { ...item, secondShiftTypeId: Number(e.target.value) } : item) })}>{data.shiftTypes.filter((type) => !type.deletedAt).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><button onClick={() => update({ sequenceRules: monthly.sequenceRules.filter((_, i) => i !== index) })}>{typeName(rule.firstShiftTypeId)} → {typeName(rule.secondShiftTypeId)} を削除</button></div>)}
        <button disabled={data.shiftTypes.filter((type) => !type.deletedAt).length < 2} onClick={() => { const available = data.shiftTypes.filter((type) => !type.deletedAt); update({ sequenceRules: [...monthly.sequenceRules, { firstShiftTypeId: available[0].id, secondShiftTypeId: available[1].id }] }); }}>この月の翌日ルールを追加</button>
      </fieldset>
      <fieldset><legend>この月だけの勤務不可曜日</legend><p>曜日単位の希望・不可条件です。勤務種別とは別に設定します。</p><div className="monthly-unavailable-table">
        {data.staff.map((staff) => <div className="monthly-unavailable-row" key={staff.id}><strong>{staff.name}</strong><div>{WEEKDAY_LABELS.map((label, weekday) => <label key={weekday}><input type="checkbox" checked={monthly.unavailableConditions.some((item) => item.staffId === staff.id && item.conditionType === "WEEKDAY" && item.value === weekday)} onChange={() => toggleUnavailable(staff.id, "WEEKDAY", weekday)} />{label}</label>)}</div></div>)}
      </div></fieldset>
      <fieldset><legend>この月だけの勤務不可種別</legend><p>職員ごとに、今月だけ割り当てない勤務種別を選びます。</p><div className="monthly-unavailable-table">
        {data.staff.map((staff) => <div className="monthly-unavailable-row" key={staff.id}><strong>{staff.name}</strong><div>{data.shiftTypes.filter((type) => !type.deletedAt).map((type) => <label key={type.id}><input type="checkbox" checked={monthly.unavailableConditions.some((item) => item.staffId === staff.id && item.conditionType === "SHIFT_TYPE" && item.value === type.id)} onChange={() => toggleUnavailable(staff.id, "SHIFT_TYPE", type.id)} />{type.shortName} <span>{type.name}</span></label>)}</div></div>)}
      </div></fieldset>
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
    <section className="page-shell editor">
      <div className="toolbar">
        <div>
          <p className="eyebrow">手順 3 / 3</p>
          <h2>{month.replace("-", "年")}月の勤務表を確認・編集</h2>
          <span>{pending.length ? "編集したセルはまだ保存されていません" : "保存済みの勤務表です"}</span>
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
            <button onClick={startGenerate}>条件を反映して自動生成</button>
          )}
          <button onClick={save}>編集したセルを保存</button>
          <button className="primary" onClick={exportXlsx}>
            Excelへ出力（保存済みのみ）
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
function RolesPanel({
  staff,
  onChanged,
  onError,
}: {
  staff: Staff[];
  onChanged: () => Promise<void>;
  onError?: (message: string) => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
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
        <form
          className="form-row"
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) {
              setMessage("職種名を入力してください。");
              return;
            }
            try {
              const updated = await window.shiftApi.saveRole({ name: trimmed });
              setRoles(updated);
              setName("");
              setMessage(`「${trimmed}」を追加しました。`);
              await onChanged();
            } catch {
              const error = "職種を追加できませんでした。同じ名前が登録済みでないか確認してください。";
              setMessage(error);
              onError?.(error);
            }
          }}
        >
          <input
            value={name}
            placeholder="例：介護職"
            aria-label="追加する職種名"
            aria-describedby="role-add-help"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit">
            追加
          </button>
        </form>
        <p id="role-add-help" className="field-help">例：介護職、看護職。追加後、職員の「主職種」と必要人数の設定で選べます。</p>
        {message && <p className="inline-message" role="status">{message}</p>}
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
        <h3>共通の勤務不可条件</h3>
        <p>全ての月に適用する条件です。曜日と勤務種別は別々に設定します。</p>
        <fieldset className="unavailable-group">
          <legend>勤務不可曜日</legend>
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
          </div>
        ))}
        </fieldset>
        <fieldset className="unavailable-group">
          <legend>勤務不可種別</legend>
        {staff.map((s) => (
          <div className="form-row" key={s.id}>
            <span className="name">{s.name}</span>
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
        </fieldset>
      </div>
    </div>
  );
}

function LegacySettings({
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
      <RolesPanel staff={staff} onChanged={onMasterChanged} onError={onError} />
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

type MasterSection = "roles" | "staff" | "types" | "rules";

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
  const [section, setSection] = useState<MasterSection>("staff");
  const [staff, setStaff] = useState(boot.staff);
  const [types, setTypes] = useState(boot.shiftTypes);
  const [ngPairs, setNgPairs] = useState(boot.ngPairs);
  const [sequenceRules, setSequenceRules] = useState(boot.sequenceRules);
  const [unavailableConditions, setUnavailableConditions] = useState(boot.unavailableConditions);
  const [roles, setRoles] = useState<Role[]>([]);
  const initialSettings = useRef("");
  const settingState = () => JSON.stringify({ staff, types, ngPairs, sequenceRules, unavailableConditions });
  if (!initialSettings.current) initialSettings.current = settingState();
  useEffect(() => {
    window.shiftApi.listRoles().then(setRoles);
  }, [boot]);
  useEffect(() => {
    onDirty(settingState() !== initialSettings.current);
  }, [staff, types, ngPairs, sequenceRules, unavailableConditions, onDirty]);
  const updateStaff = (index: number, change: Partial<Staff>) =>
    setStaff(staff.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const updateType = (index: number, change: Partial<ShiftType>) =>
    setTypes(types.map((item, i) => (i === index ? { ...item, ...change } : item)));
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
      onError("保存できませんでした。赤字の項目や、職員・勤務種別・制約の組み合わせを確認してください。");
    }
  };
  const employmentType = (value: string) => (value === "full" ? "常勤" : value || "その他");
  const selectStaff = (value: string) => Number(value);
  return (
    <section className="page-shell master-page">
      <header className="page-header page-header-with-action">
        <div>
          <p className="eyebrow">マスタ・制約</p>
          <h2>勤務表を作るための基本設定</h2>
          <p>一度に編集するのは一種類だけです。入力後は右上の「設定を保存」で反映します。</p>
        </div>
        <button className="primary" onClick={() => void save()}>設定を保存</button>
      </header>
      <div className="master-layout">
        <nav className="master-tabs" aria-label="設定の種類">
          {([
            ["roles", "職種", "必要人数で使う職種を管理"],
            ["staff", "職員", "氏名・雇用区分・勤務日数を管理"],
            ["types", "勤務種別", "勤務時間・略称・勤務日扱いを管理"],
            ["rules", "制約", "NGペア・翌日ルール・勤務不可を設定"],
          ] as [MasterSection, string, string][]).map(([id, label, description]) => (
            <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
              <strong>{label}</strong><small>{description}</small>
            </button>
          ))}
        </nav>
        <div className="master-content">
          {section === "roles" && <RolesPanel staff={staff} onChanged={onMasterChanged} onError={onError} />}
          {section === "staff" && (
            <>
              <section className="master-panel" aria-labelledby="staff-master-heading">
                <div className="panel-heading">
                  <div><h3 id="staff-master-heading">職員マスタ</h3><p>氏名、主職種、雇用区分、月間の勤務日数の目安を登録します。</p></div>
                  <button onClick={() => setStaff([...staff, { id: -Date.now() - staff.length, name: "", roleId: null, roleName: "", employmentType: "常勤", minDays: null, maxDays: null }])}>職員を追加</button>
                </div>
                <div className="master-table-wrap"><table className="master-table"><thead><tr><th>氏名</th><th>主職種</th><th>雇用区分</th><th>月間下限<br /><small>日</small></th><th>月間上限<br /><small>日</small></th></tr></thead><tbody>
                  {staff.map((item, index) => <tr key={item.id}>
                    <td><label><span className="sr-only">氏名</span><input value={item.name} placeholder="例：山田 花子" onChange={(e) => updateStaff(index, { name: e.target.value })} /></label></td>
                    <td><label><span className="sr-only">主職種</span><select value={item.roleId ?? ""} onChange={(e) => updateStaff(index, { roleId: e.target.value ? Number(e.target.value) : null })}><option value="">未設定</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label></td>
                    <td><label><span className="sr-only">雇用区分</span><select value={employmentType(item.employmentType)} onChange={(e) => updateStaff(index, { employmentType: e.target.value })}><option value="常勤">常勤</option><option value="非常勤">非常勤</option><option value="パート">パート</option><option value="派遣">派遣</option><option value="その他">その他</option></select></label></td>
                    <td><label><span className="sr-only">月間勤務日数の下限</span><input type="number" min="0" value={item.minDays ?? ""} onChange={(e) => updateStaff(index, { minDays: e.target.value ? Number(e.target.value) : null })} /></label></td>
                    <td><label><span className="sr-only">月間勤務日数の上限</span><input type="number" min="0" value={item.maxDays ?? ""} onChange={(e) => updateStaff(index, { maxDays: e.target.value ? Number(e.target.value) : null })} /></label></td>
                  </tr>)}
                </tbody></table></div>
              </section>
              <details className="lifecycle-details"><summary>職員を削除・復元する</summary><p>削除しても過去の勤務表は消えません。削除済みの職員はここから復元できます。</p><StaffLifecyclePanel onChanged={onMasterChanged} /></details>
            </>
          )}
          {section === "types" && (
            <>
              <section className="master-panel" aria-labelledby="shift-type-master-heading">
                <div className="panel-heading"><div><h3 id="shift-type-master-heading">勤務種別マスタ</h3><p>表に表示する略称と、勤務時間・勤務日として数えるかを設定します。</p></div><button onClick={() => setTypes([...types, { id: -Date.now() - types.length, name: "", shortName: "", colorCode: "#ffffff", startTime: null, endTime: null, countsAsWork: 1 }])}>勤務種別を追加</button></div>
                <div className="master-table-wrap"><table className="master-table shift-type-table"><thead><tr><th>名称</th><th>略称</th><th>色</th><th>開始</th><th>終了</th><th>勤務日として数える</th></tr></thead><tbody>
                  {types.map((item, index) => <tr key={item.id}>
                    <td><label><span className="sr-only">勤務種別名称</span><input value={item.name} placeholder="例：日勤" onChange={(e) => updateType(index, { name: e.target.value })} /></label></td>
                    <td><label><span className="sr-only">表の略称</span><input value={item.shortName} placeholder="例：日" maxLength={20} onChange={(e) => updateType(index, { shortName: e.target.value })} /></label></td>
                    <td><label className="color-field"><span className="sr-only">表示色</span><input type="color" value={item.colorCode} onChange={(e) => updateType(index, { colorCode: e.target.value })} /><span>{item.colorCode}</span></label></td>
                    <td><label><span className="sr-only">開始時刻</span><input type="time" value={item.startTime ?? ""} onChange={(e) => updateType(index, { startTime: e.target.value || null })} /></label></td>
                    <td><label><span className="sr-only">終了時刻</span><input type="time" value={item.endTime ?? ""} onChange={(e) => updateType(index, { endTime: e.target.value || null })} /></label></td>
                    <td><label className="checkbox-label"><input type="checkbox" checked={Boolean(item.countsAsWork)} onChange={(e) => updateType(index, { countsAsWork: e.target.checked ? 1 : 0 })} />勤務日として集計</label></td>
                  </tr>)}
                </tbody></table></div>
              </section>
              <details className="lifecycle-details"><summary>勤務種別を削除・復元する</summary><p>削除しても過去月の勤務表は保持されます。削除済みの勤務種別はここから復元できます。</p><ShiftTypeLifecyclePanel onChanged={onMasterChanged} /></details>
            </>
          )}
          {section === "rules" && <section className="master-panel rules-panel" aria-labelledby="rules-heading">
            <div className="panel-heading"><div><h3 id="rules-heading">勤務の制約</h3><p>自動生成で守るべき組み合わせと、職員ごとの勤務不可条件を設定します。</p></div></div>
            <fieldset><legend>同じ日に勤務できない組み合わせ（NGペア）</legend><p>同日に入れてはいけない職員の組み合わせを登録します。</p>{ngPairs.map((pair, index) => <div className="rule-row" key={`${pair.staffId1}-${pair.staffId2}-${index}`}><label>職員A<select value={pair.staffId1} onChange={(e) => setNgPairs(ngPairs.map((x, i) => i === index ? { ...x, staffId1: selectStaff(e.target.value) } : x))}>{staff.map((item) => <option value={item.id} key={item.id}>{item.name || "未入力の職員"}</option>)}</select></label><label>職員B<select value={pair.staffId2} onChange={(e) => setNgPairs(ngPairs.map((x, i) => i === index ? { ...x, staffId2: selectStaff(e.target.value) } : x))}>{staff.map((item) => <option value={item.id} key={item.id}>{item.name || "未入力の職員"}</option>)}</select></label><button onClick={() => setNgPairs(ngPairs.filter((_, i) => i !== index))}>この組み合わせを削除</button></div>)}<button disabled={staff.length < 2} onClick={() => setNgPairs([...ngPairs, { staffId1: staff[0].id, staffId2: staff[1].id }])}>NGペアを追加</button></fieldset>
            <fieldset><legend>翌日ルール</legend><p>例：夜勤入りの翌日は夜勤明けにする、などを設定します。</p>{sequenceRules.map((rule, index) => <div className="rule-row" key={`${rule.firstShiftTypeId}-${rule.secondShiftTypeId}-${index}`}><label>前日<select value={rule.firstShiftTypeId} onChange={(e) => setSequenceRules(sequenceRules.map((x, i) => i === index ? { ...x, firstShiftTypeId: Number(e.target.value) } : x))}>{types.map((item) => <option value={item.id} key={item.id}>{item.name || "未入力の勤務種別"}</option>)}</select></label><label>翌日<select value={rule.secondShiftTypeId} onChange={(e) => setSequenceRules(sequenceRules.map((x, i) => i === index ? { ...x, secondShiftTypeId: Number(e.target.value) } : x))}>{types.map((item) => <option value={item.id} key={item.id}>{item.name || "未入力の勤務種別"}</option>)}</select></label><button onClick={() => setSequenceRules(sequenceRules.filter((_, i) => i !== index))}>このルールを削除</button></div>)}<button disabled={types.length < 2} onClick={() => setSequenceRules([...sequenceRules, { firstShiftTypeId: types[0].id, secondShiftTypeId: types[1].id }])}>翌日ルールを追加</button></fieldset>
            <UnavailablePanel staff={staff} shiftTypes={types} conditions={unavailableConditions} setConditions={setUnavailableConditions} />
          </section>}
        </div>
      </div>
      <div className="page-footer-actions"><button className="primary" onClick={() => void save()}>設定を保存</button></div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
