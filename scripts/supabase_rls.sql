-- みんなの後悔 — Supabase RLS ハードニング
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行。
-- 目的: anon(公開キー)に「投稿の追加・閲覧」と「共感の加減算(RPC経由)」だけ許可し、
--       任意のUPDATE/DELETE・他テーブル閲覧を禁止する。冪等(再実行可)に書いてある。
--
-- 前提テーブル: koukai_posts / koukai_comments / koukai_page_views
-- ※ カラム名が実DBと違う場合は調整してください。

-- 1) RLS を有効化
alter table public.koukai_posts      enable row level security;
alter table public.koukai_comments   enable row level security;
alter table public.koukai_page_views enable row level security;

-- 2) 既存ポリシーをクリーンに張り直す
drop policy if exists "posts_select_anon"  on public.koukai_posts;
drop policy if exists "posts_insert_anon"  on public.koukai_posts;
drop policy if exists "comments_select_anon" on public.koukai_comments;
drop policy if exists "comments_insert_anon" on public.koukai_comments;
drop policy if exists "pv_insert_anon"     on public.koukai_page_views;

-- 3) koukai_posts: 閲覧(SELECT)と投稿(INSERT)のみ。UPDATE/DELETE ポリシーは作らない=禁止。
create policy "posts_select_anon" on public.koukai_posts
  for select to anon using (true);

create policy "posts_insert_anon" on public.koukai_posts
  for insert to anon
  with check (
    char_length(text) between 1 and 2000        -- 長文スパム抑止
    and coalesce(empathy, 0) = 0                 -- 新規投稿の共感は0で固定
  );

-- 4) koukai_comments: 閲覧と投稿のみ
create policy "comments_select_anon" on public.koukai_comments
  for select to anon using (true);

create policy "comments_insert_anon" on public.koukai_comments
  for insert to anon
  with check (char_length(text) between 1 and 2000);

-- 5) koukai_page_views: INSERT のみ(閲覧は許可しない=SELECTポリシーを作らない)
create policy "pv_insert_anon" on public.koukai_page_views
  for insert to anon with check (true);

-- 6) 念のため anon から直接の UPDATE/DELETE 権限を剥奪
revoke update, delete on public.koukai_posts      from anon;
revoke update, delete on public.koukai_comments   from anon;
revoke update, delete, select on public.koukai_page_views from anon;

-- 7) 共感カウントは SECURITY DEFINER 関数経由でのみ加減算可能にする
create or replace function public.increment_empathy(p_post_id bigint, p_delta int default 1)
returns void
language sql
security definer
set search_path = public
as $$
  update public.koukai_posts
     set empathy = greatest(0, coalesce(empathy, 0) + p_delta)
   where id = p_post_id;
$$;

grant execute on function public.increment_empathy(bigint, int) to anon;

-- 8) 管理操作(削除・編集)は anon では不可。管理画面は別途 service_role / 認証付きで実装すること。
--    admin.html のクライアント側SHA-256認証は飾りなので、書き込み系は必ずRLS/JWTで守る。

-- 確認用:
-- select tablename, policyname, cmd, roles from pg_policies where schemaname='public' order by tablename;
