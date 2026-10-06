import { Build, Config } from "zotero-plugin-scaffold";

// Use the installed scaffold API directly so a release build does not need its
// optional npm update check to reach the registry.
const context = await Config.loadConfig();
await new Build(context).run();
