import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const CATEGORIES = ["肉類","魚介類","野菜類","乳製品","卵・大豆製品","主食・パン","調味料","その他"];
const DEFAULT_SETTINGS = { days_7: true, days_3: true, days_1: true, same_day: true, expired: false };

function daysUntil(date) {
  const a = new Date(); a.setHours(0,0,0,0);
  const b = new Date(date + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
function status(days) {
  if (days < 0) return ["expired","期限切れ"];
  if (days === 0) return ["today","今日まで"];
  if (days <= 3) return ["soon","あと" + days + "日"];
  if (days <= 7) return ["near","あと" + days + "日"];
  return ["ok","あと" + days + "日"];
}

function App() {
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({name:"",cat:"野菜類",date:"",memo:""});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [auth, setAuth] = useState({email:"",password:"",confirm:""});

  useEffect(() => {
    supabase.auth.getSession().then(({data}) => setSession(data.session));
    const {data: listener} = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    loadAll();
  }, [session]);

  async function loadAll() {
    setLoading(true);
    const [{data: foods, error: foodError}, {data: prefs}] = await Promise.all([
      supabase.from("food_items").select("*").order("expiry_date", {ascending:true}),
      supabase.from("notification_preferences").select("*").maybeSingle()
    ]);
    if (foodError) setMessage(foodError.message);
    setItems(foods || []);
    if (prefs) setSettings({
      days_7: prefs.days_7, days_3: prefs.days_3, days_1: prefs.days_1,
      same_day: prefs.same_day, expired: prefs.expired
    });
    setLoading(false);
  }

  async function authSubmit(e) {
    e.preventDefault(); setMessage("");
    if (authMode === "register" && auth.password !== auth.confirm) {
      setMessage("パスワードが一致しません。"); return;
    }
    let result;
    if (authMode === "register") {
      result = await supabase.auth.signUp({
        email: auth.email.trim(), password: auth.password,
        options: { emailRedirectTo: location.origin }
      });
      if (!result.error) setMessage("登録しました。確認メールが届く設定の場合はメールを確認してください。");
    } else {
      result = await supabase.auth.signInWithPassword({email:auth.email.trim(), password:auth.password});
    }
    if (result.error) setMessage(result.error.message);
  }

  async function resetPassword() {
    if (!auth.email) { setMessage("メールアドレスを入力してください。"); return; }
    const {error} = await supabase.auth.resetPasswordForEmail(auth.email.trim(), {redirectTo: location.origin});
    setMessage(error ? error.message : "パスワード再設定メールを送信しました。");
  }

  async function saveItem(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.date) { setMessage("食材名と期限を入力してください。"); return; }
    let error;
    if (editing) {
      ({error} = await supabase.from("food_items").update({
        name:form.name.trim(), category:form.cat, expiry_date:form.date, memo:form.memo
      }).eq("id", editing));
    } else {
      ({error} = await supabase.from("food_items").insert({
        name:form.name.trim(), category:form.cat, expiry_date:form.date, memo:form.memo,
        user_id:session.user.id
      }));
    }
    if (error) setMessage(error.message);
    else { setMessage(editing ? "更新しました。" : "追加しました。"); resetForm(); await loadAll(); }
  }

  function resetForm() {
    setForm({name:"",cat:"野菜類",date:"",memo:""}); setEditing(null);
  }

  async function removeItem(id) {
    if (!confirm("この食材を削除しますか？")) return;
    const {error} = await supabase.from("food_items").delete().eq("id", id);
    setMessage(error ? error.message : "削除しました。");
    if (!error) await loadAll();
  }

  function startEdit(i) {
    setEditing(i.id); setForm({name:i.name,cat:i.category,date:i.expiry_date,memo:i.memo || ""});
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function saveSettings(next) {
    setSettings(next);
    const {error} = await supabase.from("notification_preferences").upsert({
      user_id:session.user.id, ...next
    });
    if (error) setMessage(error.message);
    else setMessage("通知設定を保存しました。");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { setMessage("このブラウザは通知に対応していません。"); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setMessage("通知が許可されませんでした。"); return; }
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("/sw.js");
      setMessage("通知を許可しました。iPhone/iPadではホーム画面に追加したWebアプリでの利用を推奨します。");
    }
  }

  function exportCsv() {
    const esc = v => '"' + String(v ?? "").replaceAll('"','""') + '"';
    const rows = [["食材名","カテゴリ","期限","メモ"], ...items.map(i=>[i.name,i.category,i.expiry_date,i.memo])];
    const csv = "\uFEFF" + rows.map(r=>r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="food_list.csv"; a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!session) return <Auth mode={authMode} setMode={setAuthMode} auth={auth} setAuth={setAuth} submit={authSubmit} reset={resetPassword} message={message}/>;

  const sorted = [...items].sort((a,b)=>a.expiry_date.localeCompare(b.expiry_date));
  const counts = useMemo(() => {
    let expired=0, soon=0;
    items.forEach(i=>{const d=daysUntil(i.expiry_date); if(d<0) expired++; else if(d<=3) soon++;});
    return {expired,soon};
  },[items]);

  return <div className="app">
    <header className="header">
      <div><h1>🥬 食材期限リマインダー</h1><p>{session.user.email}</p></div>
      <div className="header-actions">
        <button onClick={enableNotifications}>🔔 通知を有効化</button>
        <button onClick={()=>setShowSettings(!showSettings)}>⚙️ 設定</button>
        <button className="ghost" onClick={()=>supabase.auth.signOut()}>退出</button>
      </div>
    </header>

    {message && <div className="notice">{message}<button onClick={()=>setMessage("")}>×</button></div>}

    <section className="stats">
      <div><b>{items.length}</b><span>登録食材</span></div>
      <div><b>{counts.soon}</b><span>3日以内</span></div>
      <div><b>{counts.expired}</b><span>期限切れ</span></div>
    </section>

    {showSettings && <section className="panel">
      <h2>通知設定</h2>
      <div className="checks">
        {[["days_7","7日前"],["days_3","3日前"],["days_1","前日"],["same_day","当日"],["expired","期限切れ"]].map(([k,label])=>
          <label key={k}><input type="checkbox" checked={!!settings[k]} onChange={e=>saveSettings({...settings,[k]:e.target.checked})}/>{label}に通知</label>
        )}
      </div>
      <p className="hint">サーバー側の定期処理を設定すると、アプリを閉じていても期限通知を送れる構成です。</p>
    </section>}

    <main className="grid">
      <section className="panel">
        <h2>{editing ? "食材を編集" : "食材を追加"}</h2>
        <form onSubmit={saveItem}>
          <label>食材名<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="例：牛乳"/></label>
          <label>カテゴリ<select value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label>
          <label>消費・賞味期限<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
          <label>メモ<input value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})} placeholder="例：開封済み"/></label>
          <div className="form-actions"><button className="primary">{editing?"更新":"追加"}</button>{editing&&<button type="button" onClick={resetForm}>キャンセル</button>}</div>
        </form>
      </section>

      <section>
        <div className="list-head"><h2>冷蔵庫</h2><button onClick={exportCsv}>CSV出力</button></div>
        {loading ? <div className="empty">読み込み中…</div> : sorted.length===0 ? <div className="empty">食材を登録してください。</div> :
          <div className="items">{sorted.map(i=>{
            const [cls,label]=status(daysUntil(i.expiry_date));
            return <article className={"item "+cls} key={i.id}>
              <div><h3>{i.name}</h3><div className="meta">{i.category} ・ 期限 {i.expiry_date}</div>{i.memo&&<p>{i.memo}</p>}</div>
              <div className="item-right"><span className="badge">{label}</span><div><button onClick={()=>startEdit(i)}>編集</button><button className="danger" onClick={()=>removeItem(i.id)}>削除</button></div></div>
            </article>
          })}</div>
        }
      </section>
    </main>
    <footer>データはSupabaseに保存され、同じアカウントなら別端末から同期できます。</footer>
  </div>
}

function Auth({mode,setMode,auth,setAuth,submit,reset,message}) {
  return <div className="auth-wrap"><div className="auth-card">
    <h1>🥬 食材期限リマインダー</h1>
    <p className="subtitle">{mode==="login"?"ログイン":"新規アカウント登録"}</p>
    {message&&<div className="notice">{message}</div>}
    <form onSubmit={submit}>
      <label>メールアドレス<input type="email" required value={auth.email} onChange={e=>setAuth({...auth,email:e.target.value})}/></label>
      <label>パスワード<input type="password" minLength="8" required value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})}/></label>
      {mode==="register"&&<label>パスワード（確認）<input type="password" minLength="8" required value={auth.confirm} onChange={e=>setAuth({...auth,confirm:e.target.value})}/></label>}
      <button className="primary full">{mode==="login"?"ログイン":"登録する"}</button>
    </form>
    {mode==="login"&&<button className="link" onClick={reset}>パスワード再設定メールを送る</button>}
    <button className="link" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"新規アカウント登録":"ログインへ戻る"}</button>
  </div></div>
}

createRoot(document.getElementById("root")).render(<App/>);
