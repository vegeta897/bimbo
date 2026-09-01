import * as fs from "node:fs"
import { platform } from "node:os"
import { exec } from "node:child_process"
import { clipboard, Menu, nativeImage, Tray, shell } from "electron"
import strings from "../../config/strings.js"
import urls from "../../config/urls.js"
import config from "../../config/index.js"
import projects from "../projects.js"
import { activeProject } from "../../index.js"
import {
    APP_SETTINGS,
    LOG_PATH,
    openExternalUrl,
    showMessageBox,
    showPrompt,
    USER_DATA_PATH,
} from "../electron.js"
import { checkVersion, CURRENT_VERSION, versionIsCurrent } from "../version.js"
import { clearConfig } from "../index.js"
import { postToBugsplat } from "../bugsplat.js"
import { getProjectsMenu } from "./projects-menu.js"
import { getDeployMenuItems } from "./deploy-menu.js"
import { getSettingsMenu } from "./settings-menu.js"

let tray // instantiated in initializeTray() when app is ready
let trayMenu // the menu itself, made available for quick changes

// called once from app/index.js
export function initializeTray() {
    tray = new Tray(nativeImage.createFromDataURL(config.ICON))
    rebuildTray()
    tray.on("click", (event) => {
        rebuildTray(event.shiftKey === true)
        // allow opening context menu with left click on windows
        if (platform() === "win32") {
            tray.popUpContextMenu()
        }
    })
    tray.setIgnoreDoubleClickEvents(true)
}

// rebuild and re-assign context menu, and update title
export function rebuildTray(showDebugMenu = false) {
    const projectIsLoaded = !!activeProject
    trayMenu = Menu.buildFromTemplate([
        {
            label: strings.app.titleWithVersion(CURRENT_VERSION),
            enabled: false,
        },
        {
            id: "updateAvailable",
            label: strings.menu.updateAvailable,
            visible: versionIsCurrent,
            click: () => openExternalUrl(urls.itch),
        },
        { type: "separator" },
        getProjectsMenu(),
        {
            label: strings.menu.openPreview,
            enabled: projectIsLoaded,
            click: () => openExternalUrl(urls.localPreview),
        },
        { type: "separator" },
        {
            label: strings.menu.openEditor,
            enabled: projectIsLoaded,
            click: () => {
                logger.info(strings.logMsg.tryEditor(config.EDITOR_COMMAND))
                // TODO find alternative to exec
                exec(
                    `${config.EDITOR_COMMAND} "${activeProject.paths.ROOT}"`,
                    (error, stdout, stderr) => {
                        if (error) {
                            logger.error(error)
                            showMessageBox(strings.popups.codiumError)
                        }
                        if (stdout) {
                            logger.info(stdout)
                        }
                        if (stderr) {
                            logger.error(stderr)
                        }
                    },
                )
            },
        },
        {
            label: strings.menu.openFolder,
            enabled: projectIsLoaded,
            click: () => shell.openPath(activeProject.paths.ROOT),
        },
        { type: "separator" },
        ...getDeployMenuItems(),
        { type: "separator" },
        getSettingsMenu(),
        {
            label: strings.menu.support.title,
            type: "submenu",
            submenu: Menu.buildFromTemplate([
                {
                    label: strings.menu.support.checkForUpdates,
                    click: () => checkVersion(showUpdateNoticeInTray),
                },
                {
                    label: strings.menu.support.openDiscord,
                    click: () => openExternalUrl(urls.discord),
                },
                {
                    label: strings.menu.support.sendEmail,
                    click: () => {
                        postToBugsplat(new Error("user prompted email"))
                        openExternalUrl(urls.supportMailto)
                    },
                },
            ]),
        },
        {
            label: strings.menu.debug.title,
            visible: showDebugMenu,
            type: "submenu",
            submenu: Menu.buildFromTemplate([
                {
                    label: strings.menu.debug.copyLog,
                    click: () => {
                        const LOG_CONTENTS = fs.readFileSync(LOG_PATH, "utf-8")
                        clipboard.writeText(LOG_CONTENTS)
                    },
                },
                {
                    label: strings.menu.debug.openUserData,
                    click: () => shell.openPath(USER_DATA_PATH),
                },
                {
                    label: strings.menu.debug.deleteSecrets,
                    click: () => {
                        const CLICKED_ID = showPrompt(
                            strings.popups.confirmDeleteSecrets.message,
                            "warning",
                            [
                                strings.popups.confirmDeleteSecrets.confirm,
                                strings.popups.confirmDeleteSecrets.cancel,
                            ],
                        )
                        if (CLICKED_ID == 0) {
                            fs.rmSync(activeProject.paths.SECRETS_FILE)
                        }
                    },
                },
                {
                    label: strings.menu.debug.clearConfig,
                    click: clearConfig,
                },
            ]),
        },
        {
            label: strings.menu.exit,
            role: "quit",
        },
    ])
    updateTrayTitle()
    tray.setContextMenu(trayMenu)
}

export function updateTrayTitle() {
    const title = projects.getActiveTitle()
    tray.setToolTip(title)

    const trayTitle = APP_SETTINGS.get("settings.showProjectTitleInMenubar")
        ? title
        : ""
    tray.setTitle(trayTitle) // only visible on mac
}

// update a single tray menu item by its ID
export function updateTrayMenuItem(menuItemId, updates) {
    const menuItem = trayMenu.getMenuItemById(menuItemId)
    Object.assign(menuItem, updates) // merge updates into menu item properties
    tray.setContextMenu(trayMenu)
}

export function showUpdateNoticeInTray() {
    updateTrayMenuItem("updateAvailable", { visible: true })
}
