"use client";

import { ROLE_LABEL, type Role } from "@dig/contracts";
import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { SectionHeader } from "./ui";

const ACTOR = "gou.ishii@dgloss.co.jp";
const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "USER"];

interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  personId: string | null;
  active: boolean;
  /** 従業員マスタの事業部（未紐付けは null） */
  division?: string | null;
  /** 従業員マスタの所属組織（組織で絞り込むのに使う） */
  orgUnitId?: number | null;
  /** パスワード発行済みか */
  hasPassword?: boolean;
  mustChangePassword?: boolean;
  /** 会社メールが取れず従業員IDから生成した仮メールか */
  placeholderEmail?: boolean;
}

const empty: Account = { id: "", email: "", name: "", role: "USER", personId: null, active: true };

interface Unlinked {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface PickerMember {
  personId: string;
  name: string;
  division: string;
}

/** 一括発行の対象に選べる組織（事業部・グループ）。 */
interface OrgOption {
  id: number;
  name: string;
  level: string;
  parentId: number | null;
  path: string;
  /** 組織設定で「Dig評価の対象」に指定されているか（自分または祖先） */
  inTargetScope: boolean;
  /** 直下の人数（配下含む） */
  totalMembers: number;
}

interface ProvisionResult {
  scope: string;
  divisions: string[] | null;
  /** scope=org のとき、対象になった組織ID（指定した組織＋配下） */
  orgUnitIds?: number[] | null;
  targets: number;
  created: number;
  updated: number;
  skipped: { personId: string; name: string; reason: string }[];
  placeholders: { personId: string; name: string; email: string }[];
  emailUpgraded?: { personId: string; name: string; from: string; to: string }[];
  credentials: { personId: string; name: string; email: string; temporaryPassword: string }[];
}

function roleStyle(role: Role): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "bg-violet-100 text-brand-accent";
    case "ADMIN":
      return "bg-blue-100 text-brand-primary";
    default:
      return "bg-slate-100 text-ink-muted";
  }
}

export function AccountsAdmin() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<Account>(empty);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "mock" | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  /**
   * 発行した仮パスワードの積み上げ。事業部ごとに何度か発行しても消えないよう、
   * 画面を離れるまでここに貯める（同じ人を再発行したら新しい方で置き換える）。
   */
  const [issued, setIssued] = useState<Credential[]>([]);
  // サインインしたが従業員マスタと自動突合できなかったアカウント（管理者が紐付ける）。
  const [unlinked, setUnlinked] = useState<Unlinked[]>([]);
  const [pickerMembers, setPickerMembers] = useState<PickerMember[]>([]);
  const [linkInput, setLinkInput] = useState<Record<string, string>>({});
  // 評価対象の事業部（この事業部のメンバーだけを既定で表示する）。
  const [targetDivisions, setTargetDivisions] = useState<string[]>([]);
  const [resetExisting, setResetExisting] = useState(false);
  // 組織の全階層（配下の解決に使う）。一覧の絞り込みと一括発行の両方がこれを見る。
  const [allOrgUnits, setAllOrgUnits] = useState<OrgOption[]>([]);
  /** "" = 評価対象事業部 / "all" = 全アカウント / それ以外 = 組織ID */
  const [orgFilter, setOrgFilter] = useState("");
  /** パスワードの発行状況で絞り込む。"" = すべて */
  const [pwFilter, setPwFilter] = useState<"" | "none" | "temp" | "set">("");

  // 一括発行で選べるのは事業部とグループ（チームは出さない）。
  const orgOptions = allOrgUnits.filter((o) => o.level === "事業部" || o.level === "グループ");

  /** 指定した組織とその配下すべての組織ID。 */
  const descendantsOf = (rootId: number): Set<number> => {
    const ids = new Set<number>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of allOrgUnits) {
        if (u.parentId !== null && ids.has(u.parentId) && !ids.has(u.id)) {
          ids.add(u.id);
          grew = true;
        }
      }
    }
    return ids;
  };

  const selectedOrg = orgOptions.find((o) => String(o.id) === orgFilter) ?? null;

  // 「Dig評価の対象」は組織設定のチェックが正。組織が未登録のときだけ旧・評価対象事業部を使う。
  const targetOrgIds = new Set(allOrgUnits.filter((o) => o.inTargetScope).map((o) => o.id));
  const targetLabel =
    allOrgUnits.length > 0
      ? allOrgUnits
          .filter((o) => o.inTargetScope && o.level === "事業部")
          .map((o) => o.name)
          .join("・") || "未設定"
      : targetDivisions.join("・") || "未設定";

  /** アカウントのパスワード状態。 */
  const pwStateOf = (a: Account): "none" | "temp" | "set" =>
    !a.hasPassword ? "none" : a.mustChangePassword ? "temp" : "set";

  // 画面に表示するアカウント。組織を選べばその組織＋配下、既定はDig評価の対象。
  const inScope = selectedOrg
    ? (() => {
        const ids = descendantsOf(selectedOrg.id);
        return accounts.filter((a) => a.orgUnitId != null && ids.has(a.orgUnitId));
      })()
    : orgFilter === "none"
      ? accounts.filter((a) => a.orgUnitId == null)
      : orgFilter === "all"
        ? accounts
        : allOrgUnits.length > 0
          ? accounts.filter((a) => a.orgUnitId != null && targetOrgIds.has(a.orgUnitId))
          : accounts.filter((a) => a.division && targetDivisions.includes(a.division));

  // 組織が紐付いていないアカウント（従業員マスタ未紐付け、または組織未設定）。
  // 組織で絞るとどこにも出てこなくなるため、専用の選択肢を用意して見えるようにする。
  const noOrgAccounts = accounts.filter((a) => a.orgUnitId == null);

  // パスワードの発行状況での絞り込み。件数はこの組織の中での内訳を出す。
  const pwCount = {
    none: inScope.filter((a) => pwStateOf(a) === "none").length,
    temp: inScope.filter((a) => pwStateOf(a) === "temp").length,
    set: inScope.filter((a) => pwStateOf(a) === "set").length,
  };
  const visible = pwFilter ? inScope.filter((a) => pwStateOf(a) === pwFilter) : inScope;

  async function load() {
    try {
      setAccounts(await apiGet<Account[]>("/api/accounts"));
      setSource("db");
    } catch {
      setSource("mock");
    }
    try {
      const [u, m, t, o] = await Promise.all([
        apiGet<Unlinked[]>("/api/accounts/unlinked"),
        apiGet<PickerMember[]>("/api/my-page/members"),
        apiGet<{ targets: string[]; all: string[] }>("/api/target-divisions"),
        apiGet<OrgOption[]>("/api/org-units").catch(() => [] as OrgOption[]),
      ]);
      setUnlinked(u);
      setPickerMembers(m);
      setTargetDivisions(t.targets ?? []);
      setAllOrgUnits(o);
    } catch {
      /* 紐付け待ちの取得失敗は一覧表示に影響させない */
    }
  }

  // 紐付け待ちアカウントへ従業員IDを設定する（権限は変更しない）。
  async function link(a: Unlinked, personId: string) {
    if (!personId) return;
    setBusy(true);
    try {
      await apiSend("/api/accounts", "POST", {
        id: a.id,
        email: a.email,
        name: pickerMembers.find((m) => m.personId === personId)?.name ?? a.name,
        role: a.role,
        personId,
        active: true,
        actor: ACTOR,
      });
      setMsg(`${a.email} を従業員 ${personId} に紐付けました`);
      setLinkInput((prev) => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
      await load();
    } catch (e) {
      setMsg(`紐付け失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  /** 発行済み一覧に積み増す。同じメールが既にあれば新しい方で置き換える。 */
  const addIssued = (rows: Credential[]) => {
    if (rows.length === 0) return;
    setIssued((prev) => {
      const byEmail = new Map(prev.map((c) => [c.email, c]));
      for (const r of rows) byEmail.set(r.email, r);
      return [...byEmail.values()];
    });
  };

  /**
   * 選んだ組織（事業部またはグループ）とその配下の在籍メンバーへ、
   * ユーザー権限のアカウントを一括発行する（既存アカウントの権限は変更しない）。
   */
  async function provision() {
    const org = selectedOrg;
    if (!org) {
      setMsg("上の「表示対象」で事業部またはグループを選んでください");
      return;
    }
    const label = `${org.path}（配下含む ${org.totalMembers}名）`;
    if (!confirm(`${label} の在籍メンバーへ「ユーザー」権限のアカウントを作成します。\n（仮パスワードは作成後に「表示中のメンバーに仮パスワードを発行」で発行します）\nよろしいですか？`)) return;
    setBusy(true);
    setMsg(`${label} のアカウントを発行中…`);
    try {
      const res = await apiSend<ProvisionResult>("/api/accounts/provision", "POST", {
        actor: ACTOR,
        scope: "org",
        orgUnitId: org.id,
        role: "USER",
        // パスワードは件数が多いとタイムアウトするため、ここでは作らない。
        // 発行は下の「表示中のメンバーに仮パスワードを発行」で分割実行する。
        issuePasswords: false,
      });
      setResult(res);
      const parts = [`対象${res.targets}名`, `新規${res.created}件`, `既存${res.updated}件（権限は変更なし）`];
      if ((res.emailUpgraded?.length ?? 0) > 0) parts.push(`会社メールへ差し替え${res.emailUpgraded?.length}件`);
      if (res.placeholders.length > 0) parts.push(`仮メール${res.placeholders.length}件（要修正）`);
      if (res.skipped.length > 0) parts.push(`スキップ${res.skipped.length}件`);
      setMsg(`アカウント作成完了: ${parts.join(" / ")}\n続けて「表示中のメンバーに仮パスワードを発行」を押してください。`);
      await load();
    } catch (e) {
      setMsg(`発行失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 一覧に表示中のアカウントへ仮パスワードを発行する。
   * ハッシュ化は意図的に重いため、25件ずつに分けて呼び出す
   * （全件を1リクエストで処理すると実行時間制限でタイムアウトする）。
   */
  async function issuePasswordsForDisplayed(reset: boolean) {
    const ids = visible.map((a) => a.id);
    if (ids.length === 0) {
      setMsg("表示中のアカウントがありません");
      return;
    }
    const note = reset
      ? "既にパスワードを設定済みの人も仮パスワードにリセットされます。"
      : "既にパスワードがある人はそのままにします。";
    if (!confirm(`表示中の ${ids.length} 名へ仮パスワードを発行します。\n${note}\nよろしいですか？`)) return;

    const CHUNK = 25;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

    setBusy(true);
    const credentials: ProvisionResult["credentials"] = [];
    let skipped = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        setMsg(`仮パスワードを発行中… ${i + 1}/${chunks.length}（${credentials.length}件発行済み）`);
        const r = await apiSend<{
          credentials: Array<{ id: string; name: string; email: string; temporaryPassword: string }>;
          skipped: number;
        }>("/api/accounts/passwords", "POST", { ids: chunks[i], actor: ACTOR, resetExisting: reset });
        credentials.push(
          ...r.credentials.map((c) => ({ personId: "", name: c.name, email: c.email, temporaryPassword: c.temporaryPassword })),
        );
        skipped += r.skipped;
      }
      addIssued(credentials);
      setMsg(
        `仮パスワードを発行しました: ${credentials.length}件` +
          (skipped > 0 ? ` / 既にパスワードがあるため据え置き ${skipped}件` : "") +
          `\n下の一覧をコピーまたはCSVで控えてから画面を離れてください（再表示できません）。`,
      );
      await load();
    } catch (e) {
      setMsg(
        `発行に失敗しました: ${(e as Error).message}\n` +
          `※ ここまでに発行済みの ${credentials.length} 件は有効です。下の一覧を控えてから再実行してください。`,
      );
      addIssued(credentials);
    } finally {
      setBusy(false);
    }
  }

  // 1名の仮パスワードを再発行する（平文は画面に一度だけ表示される）。
  async function reissue(id: string, name: string) {
    if (!confirm(`${name} の仮パスワードを再発行します。現在のパスワードは使えなくなります。よろしいですか？`)) return;
    setBusy(true);
    try {
      const r = await apiSend<{ email: string; name: string; temporaryPassword: string }>(
        `/api/accounts/${encodeURIComponent(id)}/password`,
        "POST",
        { actor: ACTOR },
      );
      addIssued([{ personId: "", name: r.name, email: r.email, temporaryPassword: r.temporaryPassword }]);
      setMsg(`${r.name} の仮パスワードを再発行しました。下の一覧から控えて本人へ渡してください。`);
      await load();
    } catch (e) {
      setMsg(`再発行失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form.id || !form.email || !form.name) {
      setMsg("ID・メール・氏名 は必須です");
      return;
    }
    try {
      await apiSend("/api/accounts", "POST", { ...form, actor: ACTOR });
      setMsg(`アカウント ${form.name} を保存しました`);
      setForm(empty);
      await load();
    } catch (e) {
      setMsg(`保存失敗: ${(e as Error).message}`);
    }
  }
  async function del(id: string) {
    if (!confirm(`${id} を削除しますか？`)) return;
    const res = await fetch(`/api/accounts/${encodeURIComponent(id)}?actor=${ACTOR}`, { method: "DELETE" });
    if (res.ok) {
      setMsg(`${id} を削除しました`);
      await load();
    }
  }

  return (
    <>
      <SectionHeader
        title="アカウント管理"
        note="スーパーADMINのみアクセス可。権限（スーパーADMIN／ADMIN／ユーザー）を付与。"
        accent="accent"
      />

      {/* 権限の凡例 */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <RoleCard role="SUPER_ADMIN" desc="全機能＋金融承認・従業員マスタ・アカウント管理" />
        <RoleCard role="ADMIN" desc="運用＋Dig獲得ルール・設定編集（金融承認/従業員マスタ 不可）" />
        <RoleCard role="USER" desc="閲覧のみ（予実・評価・ボーナス・取引・リリース）" />
      </div>

      {source === "mock" && (
        <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">DB未接続のためモック表示です。</div>
      )}
      {msg && (
        <div className="mb-3 whitespace-pre-wrap rounded-card bg-blue-50 px-3 py-2 text-xs text-brand-primary">
          {msg}
        </div>
      )}

      {/* 仮パスワードの発行（表示中のアカウントが対象） */}
      <div className="mb-4 rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-ink">表示対象</span>
          {/* この選択が一覧・仮パスワード発行・一括発行のすべての対象になる。 */}
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="rounded-card border border-surface-border bg-white px-2 py-1.5 text-sm"
          >
            <option value="">
              Dig評価の対象（{targetLabel}）
            </option>
            {orgOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.path}（{o.level}・{o.totalMembers}名）
              </option>
            ))}
            {noOrgAccounts.length > 0 && (
              <option value="none">組織未設定（{noOrgAccounts.length}名）</option>
            )}
            <option value="all">全アカウント（{accounts.length}名）</option>
          </select>
          {/* 発行状況での絞り込み。誰にまだ発行していないかをすぐ出せるようにする。 */}
          <select
            value={pwFilter}
            onChange={(e) => setPwFilter(e.target.value as typeof pwFilter)}
            title="パスワードの発行状況で絞り込む"
            className="rounded-card border border-surface-border bg-white px-2 py-1.5 text-sm"
          >
            <option value="">パスワード状態: すべて</option>
            <option value="none">未発行（{pwCount.none}名）</option>
            <option value="temp">仮パスワード（{pwCount.temp}名）</option>
            <option value="set">設定済み（{pwCount.set}名）</option>
          </select>
          <span className="text-xs text-ink-muted">
            表示中 {visible.length}名 / 全{accounts.length}名
          </span>
        </div>

        {noOrgAccounts.length > 0 && orgFilter !== "none" && orgFilter !== "all" && (
          <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">
            組織が紐付いていないアカウントが <b>{noOrgAccounts.length}名</b> います
            （{noOrgAccounts.slice(0, 5).map((a) => a.name).join("・")}
            {noOrgAccounts.length > 5 ? " ほか" : ""}）。
            事業部を選んだ状態では一覧に出ないため、
            <button
              onClick={() => setOrgFilter("none")}
              className="mx-1 underline decoration-dotted underline-offset-2"
            >
              「組織未設定」で表示
            </button>
            して、従業員IDの紐付けか全従業員一覧での組織設定を行ってください。
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void issuePasswordsForDisplayed(resetExisting)}
            disabled={busy || visible.length === 0}
            className="rounded-card bg-brand-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "処理中…" : `表示中の ${visible.length}名 に仮パスワードを発行`}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={resetExisting}
              onChange={(e) => setResetExisting(e.target.checked)}
            />
            既にパスワードがある人も作り直す
          </label>
        </div>

        {visible.some((a) => a.placeholderEmail) && (
          <div className="mb-3 rounded-card bg-amber-50 px-3 py-2 text-xs text-semantic-warn">
            表示中に<b>仮メールのアカウントが {visible.filter((a) => a.placeholderEmail).length}名</b>います
            （<span className="tabular">従業員ID@dgloss.co.jp</span> の形式）。jinjer に会社メールが未登録の人です。
            このままでは本人がログインできないため、
            <b>先に jinjer へ会社メールを登録 →「① jinjer同期」→ 下の折りたたみからアカウント作成を再実行</b>
            すると実メールへ自動で差し替わります。個別に直す場合は一覧の「編集」からメールを修正してください。
          </div>
        )}

        <div className="text-xs text-ink-muted">
          パスワード状態を「未発行」に絞れば、<b>まだ発行していない人だけ</b>に発行できます。
          仮パスワードは<b>上で表示中のアカウント</b>にだけ発行します（25名ずつ分割して実行するため、
          人数が多くてもタイムアウトしません）。チェックを入れない限り、既にパスワードがある人は据え置きます。
          発行した平文は<b>この画面でしか見られません</b>。必ずコピーかCSVで控えてください。
        </div>

        <details className="mt-3 text-xs text-ink-muted">
          <summary className="cursor-pointer font-semibold text-ink">
            従業員マスタからアカウントを作成する（新入社員が増えたとき）
          </summary>
          <div className="mt-2">
            在籍メンバーへ「ユーザー」権限のアカウントを作成します。メールは jinjer の会社メールを使い、
            取得できない人は <span className="tabular">従業員ID@dgloss.co.jp</span> の仮メールで作ります（下に要修正として表示）。
            既にアカウントがある人は氏名と従業員IDの紐付けだけ更新し、<b>権限は変更しません</b>。
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void provision()}
                disabled={busy || !selectedOrg}
                className="rounded-card bg-brand-primary px-4 py-1.5 font-bold text-white disabled:opacity-50"
              >
                {selectedOrg ? `${selectedOrg.path} に一括発行` : "上で組織を選んでください"}
              </button>
              {selectedOrg && (
                <span className="text-[11px] text-ink-muted">
                  配下含む {selectedOrg.totalMembers}名が対象
                </span>
              )}
            </div>
            {orgOptions.length === 0 && (
              <div className="mt-2 text-semantic-warn">
                事業部・グループが未登録です。従業員マスタの「組織設定」で先に登録してください。
              </div>
            )}
            <div className="mt-2 text-[11px] text-ink-faint">
              ※ 上の「表示対象」で選んだ組織が対象です。事業部を選ぶとその事業部全体（配下のグループ・チームを含む）、
              グループを選ぶとそのグループ配下が対象になります。
              組織が未設定のメンバーはどの選択肢にも含まれないため、先に全従業員一覧で組織を設定してください。
              <b>作成しただけではパスワードは発行されません。</b>続けて上の「表示中の◯名に仮パスワードを発行」を押してください。
            </div>
          </div>
        </details>

        {issued.length > 0 && (
          <div className="mt-4 rounded-card border border-brand-primary bg-blue-50 p-3">
            <div className="mb-1 text-sm font-semibold text-brand-primary">
              発行した仮パスワード {issued.length}件（この画面で発行した分の累計）
            </div>
            <div className="mb-2 text-xs text-ink-muted">
              パスワードはハッシュ化して保存されるため、<b>この画面を閉じると二度と表示できません</b>。
              コピーまたはCSVで控えて各自へ配布してください。本人は初回ログイン後にパスワード変更を求められます。
              <b>事業部を切り替えて続けて発行しても、ここには消えずに積み上がります。</b>
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                onClick={() => copyCredentials(issued)}
                className="rounded-card bg-brand-primary px-3 py-1 text-xs font-semibold text-white"
              >
                一覧をコピー（{issued.length}件）
              </button>
              <button
                onClick={() => downloadCredentials(issued)}
                className="rounded-card border border-brand-primary px-3 py-1 text-xs font-semibold text-brand-primary"
              >
                CSVをダウンロード（{issued.length}件）
              </button>
              <button
                onClick={() => {
                  if (confirm(`発行した ${issued.length}件の表示を消します。控えは取りましたか？\n（パスワードは二度と表示できません）`))
                    setIssued([]);
                }}
                className="ml-auto rounded-card border border-surface-border px-3 py-1 text-xs text-ink-muted"
              >
                表示をクリア
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-card bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-panel text-left text-ink-muted">
                    <th className="px-2 py-1.5 font-semibold">氏名</th>
                    <th className="px-2 py-1.5 font-semibold">ログインID（メール）</th>
                    <th className="px-2 py-1.5 font-semibold">仮パスワード</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {issued.map((c) => (
                    <tr key={c.email} className="border-b border-surface-border last:border-0">
                      <td className="px-2 py-1.5">{c.name}</td>
                      <td className="px-2 py-1.5 text-ink-muted">{c.email}</td>
                      <td className="px-2 py-1.5 font-mono font-semibold text-ink">{c.temporaryPassword}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && (result.placeholders.length > 0 || result.skipped.length > 0) && (
          <div className="mt-3 space-y-2 text-xs">
            {result.placeholders.length > 0 && (
              <details className="rounded-card bg-amber-50 px-3 py-2 text-semantic-warn">
                <summary className="cursor-pointer font-semibold">
                  仮メールで発行した {result.placeholders.length}名（実メールへ修正してください）
                </summary>
                <div className="mt-2 space-y-0.5 text-ink-muted">
                  {result.placeholders.map((p) => (
                    <div key={p.personId} className="tabular">
                      {p.personId} {p.name} → {p.email}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {result.skipped.length > 0 && (
              <details className="rounded-card bg-rose-50 px-3 py-2 text-semantic-danger">
                <summary className="cursor-pointer font-semibold">発行できなかった {result.skipped.length}名</summary>
                <div className="mt-2 space-y-0.5 text-ink-muted">
                  {result.skipped.map((p) => (
                    <div key={p.personId} className="tabular">
                      {p.personId} {p.name}（{p.reason}）
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* 紐付け待ち（サインイン済みだが従業員マスタと突合できなかった人） */}
      {unlinked.length > 0 && (
        <div className="mb-4 rounded-card border border-semantic-warn bg-amber-50 p-4">
          <div className="mb-2 text-sm font-semibold text-semantic-warn">
            従業員マスタと紐付いていないアカウント {unlinked.length}件
          </div>
          <div className="mb-3 text-xs text-ink-muted">
            サインインはできていますが、会社メール・氏名のどちらでも従業員を特定できませんでした。
            紐付けるとマイページ（本人の実績・借入・Dig申請）が表示されます。
          </div>
          <div className="space-y-2">
            {unlinked.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink">{a.name}</span>
                <span className="text-ink-muted">{a.email}</span>
                <select
                  value={linkInput[a.id] ?? ""}
                  onChange={(e) => setLinkInput({ ...linkInput, [a.id]: e.target.value })}
                  className="rounded-card border border-surface-border bg-white px-2 py-1 text-xs"
                >
                  <option value="">従業員を選択</option>
                  {pickerMembers.map((m) => (
                    <option key={m.personId} value={m.personId}>
                      {m.name}（{m.personId}／{m.division}）
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void link(a, linkInput[a.id] ?? "")}
                  disabled={busy || !linkInput[a.id]}
                  className="rounded-card bg-brand-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  紐付け
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-panel text-left text-xs text-ink-muted">
              <th className="px-4 py-2.5 font-semibold">氏名</th>
              <th className="px-4 py-2.5 font-semibold">メール</th>
              <th className="px-4 py-2.5 font-semibold">事業部</th>
              <th className="px-4 py-2.5 font-semibold">権限</th>
              <th className="px-4 py-2.5 font-semibold">従業員ID</th>
              <th className="px-4 py-2.5 text-center font-semibold">パスワード</th>
              <th className="px-4 py-2.5 text-center font-semibold">状態</th>
              <th className="px-4 py-2.5 text-center font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-3 text-ink-muted">
                  {pwFilter
                    ? "この条件に一致するアカウントはありません（パスワード状態の絞り込みを外してください）"
                    : "表示できるアカウントがありません（組織設定の「Dig評価の対象」、または従業員IDの紐付けをご確認ください）"}
                </td>
              </tr>
            )}
            {visible.map((a) => (
              <tr key={a.id} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                <td className="px-4 py-2.5 text-ink-muted">
                  {a.email}
                  {a.placeholderEmail && (
                    <span
                      title="jinjer に会社メールが無いため従業員IDから生成した仮メールです。このままではログインできません。"
                      className="ml-1.5 rounded-pill bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-semantic-warn"
                    >
                      仮メール
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{a.division ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${roleStyle(a.role)}`}>
                    {ROLE_LABEL[a.role]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{a.personId ?? "—"}</td>
                <td className="px-4 py-2.5 text-center text-xs">
                  {a.hasPassword ? (
                    a.mustChangePassword ? (
                      <span className="text-semantic-warn">仮パスワード</span>
                    ) : (
                      <span className="text-semantic-success">設定済み</span>
                    )
                  ) : (
                    <span className="text-ink-faint">未発行</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs ${a.active ? "text-semantic-success" : "text-ink-faint"}`}>
                    {a.active ? "有効" : "無効"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => void reissue(a.id, a.name)} className="mr-2 text-xs font-semibold text-semantic-warn">仮PW発行</button>
                  <button onClick={() => setForm(a)} className="mr-2 text-xs font-semibold text-brand-primary">編集</button>
                  <button onClick={() => del(a.id)} className="text-xs text-semantic-danger">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-card border border-surface-border bg-white p-4 shadow-card">
        <div className="mb-3 text-sm font-semibold text-ink">アカウント 登録 / 更新</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Fld label="ID(メール)"><input className="inp" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value, email: form.email || e.target.value })} /></Fld>
          <Fld label="メール"><input className="inp" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Fld>
          <Fld label="氏名"><input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="権限">
            <select className="inp" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Fld>
          <Fld label="従業員ID(任意)"><input className="inp" value={form.personId ?? ""} onChange={(e) => setForm({ ...form, personId: e.target.value || null })} /></Fld>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-card bg-brand-primary px-4 py-1.5 text-sm font-bold text-white">保存</button>
          <button onClick={() => setForm(empty)} className="rounded-card border border-surface-border px-4 py-1.5 text-sm text-ink-muted">クリア</button>
        </div>
      </div>
      <style>{`.inp{width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;font-size:13px}`}</style>
    </>
  );
}

/** 発行した仮パスワード1件（平文はこの画面にしか存在しない）。 */
type Credential = { personId: string; name: string; email: string; temporaryPassword: string };

/** 仮パスワード一覧をタブ区切りでクリップボードへ（チャット等へ貼りやすい形）。 */
function copyCredentials(rows: Credential[]) {
  const text = ["氏名\tログインID\t仮パスワード", ...rows.map((c) => `${c.name}\t${c.email}\t${c.temporaryPassword}`)].join("\n");
  void navigator.clipboard.writeText(text);
}

/** 仮パスワード一覧をCSVでダウンロード（Excelで開けるよう BOM 付き）。 */
function downloadCredentials(rows: Credential[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = ["氏名,ログインID,仮パスワード", ...rows.map((c) => [c.name, c.email, c.temporaryPassword].map(esc).join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dig-temporary-passwords.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function RoleCard({ role, desc }: { role: Role; desc: string }) {
  return (
    <div className="rounded-card border border-surface-border bg-white p-3 shadow-card">
      <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${roleStyle(role)}`}>{ROLE_LABEL[role]}</span>
      <div className="mt-2 text-xs text-ink-muted">{desc}</div>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
