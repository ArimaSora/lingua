import { homedir } from "node:os";
import { join } from "node:path";

// 数据目录默认在仓库外（~/.lingua/），个人学习数据无入库路径。
export function dataDir(): string {
  return process.env.LINGUA_DATA_DIR ?? join(homedir(), ".lingua");
}
