-- Homey — תיקוני אבטחה מדוח 2026-09-15 (security-review-homey-app-2026-09-15.md). להריץ פעם אחת ב-SQL Editor.

-- נקודה 20: photo_url/avatar נשמרים כמחרוזת (data URL) בלי הגבלת אורך ברמת ה-DB.
-- בצד לקוח הקובץ תמיד עובר קנבס ומומר ל-JPEG 256x256 (בערך 100-150KB בפועל) — 200,000 תווים נדיב בהרבה מזה.
alter table public.profiles
  add constraint profiles_photo_url_len check (photo_url is null or length(photo_url) < 200000);
alter table public.children
  add constraint children_photo_url_len check (photo_url is null or length(photo_url) < 200000);
