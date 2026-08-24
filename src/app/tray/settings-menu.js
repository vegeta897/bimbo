import { platform } from "node:os"
import strings from "../../config/strings.js"
import { APP_SETTINGS, showPrompt } from "../electron.js"
import { configureCrashReporting } from "../bugsplat.js"
import { updateTrayMenuItem, updateTrayTitle } from "./index.js"

export function getSettingsMenu() {
    const createSettingsItem = (setting, options = {}, afterClick) => {
        return {
            id: setting,
            label: strings.menu.settings[setting],
            type: "checkbox",
            checked: APP_SETTINGS.get(`settings.${setting}`),
            click: () => {
                const enabled = APP_SETTINGS.get(`settings.${setting}`)
                APP_SETTINGS.set(`settings.${setting}`, !enabled)
                if (afterClick) {
                    afterClick()
                }
            },
            ...options,
        }
    }
    const submenu = [
        createSettingsItem(
            "showProjectTitleInMenubar",
            {
                visible: platform() === "darwin", // only relevant on mac
            },
            updateTrayTitle,
        ),
        createSettingsItem("autoOpenPreview"),
        createSettingsItem("submitCrashLogs", {
            click: () => {
                const enabled = APP_SETTINGS.get("settings.submitCrashLogs")
                if (enabled) {
                    const clickedId = showPrompt(
                        strings.popups.disableCrashReporting.message,
                        "warning",
                        [
                            strings.popups.disableCrashReporting.confirm,
                            strings.popups.disableCrashReporting.cancel,
                        ],
                    )
                    if (clickedId !== 0) {
                        // re-check menu item because electron unchecks it
                        updateTrayMenuItem("submitCrashLogs", { checked: true })
                        return
                    }
                }
                APP_SETTINGS.set("settings.submitCrashLogs", !enabled)
                configureCrashReporting()
            },
        }),
        createSettingsItem("bskyAutoPost", {
            visible: false, // TODO change when ready
        }),
    ]
    return {
        label: strings.menu.settings.title,
        type: "submenu",
        submenu,
    }
}
