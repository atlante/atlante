import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncBrandAssets } from "../../scripts/sync-brand-assets";

const packsRoot = dirname(dirname(fileURLToPath(import.meta.url)));

syncBrandAssets({ workspaceRoot: packsRoot });
