import { BugSplatNode as BugSplat } from "bugsplat-node"
import { app, crashReporter } from "electron"
import { APP_SETTINGS, LOG_PATH } from "./electron.js"
import { CURRENT_VERSION } from "./version.js"
import config from "../config/index.js"
import urls from "../config/urls.js"

let bugsplat = null

export function configureCrashReporting() {
    const javaScriptErrorHandler = async (error) => {
        await bugsplat.post(error)
        app.quit()
    }

    bugsplat = APP_SETTINGS.get("settings.submitCrashLogs")
        ? new BugSplat("me-iznaut-com", "bimbo", CURRENT_VERSION)
        : null

    if (bugsplat && !config.DEV_MODE) {
        bugsplat.setDefaultAdditionalFilePaths([LOG_PATH])
        crashReporter.start({
            submitURL: urls.bugsplat,
            ignoreSystemCrashHandler: true,
            uploadToServer: true,
            rateLimit: false,
            globalExtra: {
                product: "bimbo",
                version: CURRENT_VERSION,
                key: "en-US",
            },
        })

        process.on("unhandledRejection", javaScriptErrorHandler)
        process.on("uncaughtException", javaScriptErrorHandler)
    } else {
        process.removeListener("unhandledRejection", javaScriptErrorHandler)
        process.removeListener("uncaughtException", javaScriptErrorHandler)
    }
}

export function postToBugsplat(error) {
    if (bugsplat) {
        bugsplat.post(error)
    }
}
