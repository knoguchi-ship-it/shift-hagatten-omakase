import fs from "node:fs";
import path from "node:path";

const RETENTION_DAYS = 30;

// 秘密情報・SQLite実データを含めない、日次ローテーションのローカルログ。
export class Logger {
  private dir: string;
  private available = false;
  constructor(dir: string) {
    this.dir = dir;
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.rotate();
      this.available = true;
    } catch {
      // ログ保存先の権限不足で業務アプリ本体を起動不能にしない。
      // 画面側では利用者向けエラーを別途表示し、ログは書き込まない。
    }
  }
  info(message: string) {
    this.write("INFO", message);
  }
  error(message: string) {
    this.write("ERROR", message);
  }
  private write(level: string, message: string) {
    if (!this.available) return;
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    try {
      fs.appendFileSync(this.fileFor(new Date()), line);
    } catch {
      /* ログ書き込み失敗はアプリ動作を妨げない */
    }
  }
  private fileFor(date: Date) {
    return path.join(this.dir, `${date.toISOString().slice(0, 10)}.log`);
  }
  private rotate() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(this.dir)) {
      const match = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (!match) continue;
      if (new Date(`${match[1]}T00:00:00`).getTime() < cutoff)
        fs.unlinkSync(path.join(this.dir, name));
    }
  }
}
