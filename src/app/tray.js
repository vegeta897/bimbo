import * as fs from "node:fs"
import * as path from "node:path"
import { platform } from "node:os"
import { exec } from "node:child_process"
import {
    clipboard,
    dialog,
    ipcMain,
    Menu,
    nativeImage,
    Tray,
    shell,
} from "electron"
import strings from "../config/strings.js"
import urls from "../config/urls.js"
import config from "../config/index.js"
import projects from "./projects.js"
import { presets, IS_PLUS_MODE } from "../deploy.js"
import { activeProject, getProjectStarters } from "../index.js"
import {
    APP_PATH,
    APP_SETTINGS,
    handlePickDirectory,
    LOG_PATH,
    openExternalUrl,
    showMessageBox,
    showPrompt,
    USER_DATA_PATH,
} from "./electron.js"
import { checkVersion, CURRENT_VERSION, versionIsCurrent } from "./version.js"
import { clearConfig } from "./index.js"
import { renderFormInWindow, openPageInWindow } from "./window.js"
import { configureCrashReporting, postToBugsplat } from "./bugsplat.js"
import { deploy } from "../deploy.js"

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
        {
            label: projects.getActiveTitle(),
            type: "submenu",
            submenu: getProjectsSubmenu(),
        },
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
        ...getPlusModeItems(),
        { type: "separator" },
        {
            label: strings.menu.settings.title,
            type: "submenu",
            submenu: getSettingsMenu(),
        },
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

function getProjectsSubmenu() {
    return [
        ...projects.list.map((projectPath, index) => {
            const project = projects.getFromPath(projectPath)
            const relativePath = path.relative(APP_PATH, project.paths.ROOT)
            const isStarter =
                !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
            const projectTitle = `${isStarter ? "📝 " : ""}${project.title}`
            return {
                label: projectTitle,
                type: "radio",
                checked: index === projects.activeIndex,
                click: () => {
                    projects.activeIndex = projects.list.indexOf(projectPath)
                    updateTrayTitle(projectTitle)
                    rebuildTray()
                },
            }
        }),
        { type: "separator" },
        {
            label: strings.menu.projects.create,
            click: async function () {
                const browserWindow = await openPageInWindow("new-project")
                // Send list of starters to form
                browserWindow.webContents.send(
                    "starters-list",
                    Object.keys(getProjectStarters()),
                )
                ipcMain.handle("pick-directory", () =>
                    handlePickDirectory(browserWindow),
                )
                browserWindow.on("closed", () =>
                    ipcMain.removeHandler("pick-directory"),
                )
            },
        },
        {
            label: strings.menu.projects.import,
            click: () => {
                let pickedPaths = dialog.showOpenDialogSync({
                    filters: [
                        { name: strings.app.projectFile, extensions: ["yaml"] },
                    ],
                    properties: ["openFile"],
                })

                if (!pickedPaths) {
                    return
                }

                projects.add(path.dirname(pickedPaths[0]))
                projects.activeIndex = projects.list.length - 1
                rebuildTray()
            },
        },
    ]
}

function getPlusModeItems() {
    if (!IS_PLUS_MODE) {
        return [
            {
                label: strings.menu.upgrade,
                click: () => openExternalUrl(urls.itch),
            },
        ]
    }
    const deployMeta = activeProject?.secrets?.deployment
    const bskyMeta = activeProject?.secrets?.integrations?.bluesky
    const bskyAutoPostEnabled = APP_SETTINGS.get("settings.bskyAutoPost")
    return [
        {
            label: strings.menu.deploy(deployMeta?.provider),
            visible: !!deployMeta,
            click: () => {
                // TODO project-level setting to turn off confirmation prompt?
                const CLICKED_ID = showPrompt(
                    strings.popups.confirmDeployment.message(
                        activeProject.title,
                        deployMeta.provider,
                    ),
                    "warning",
                )

                if (CLICKED_ID == 0) {
                    // TODO prompt for password if necessary
                    deploy()
                } else {
                    logger.info(strings.deployment.finish.cancel)
                }
            },
        },
        {
            label: strings.menu.configDeployment,
            enabled: !!activeProject,
            visible: !deployMeta,
            type: "submenu",
            submenu: Menu.buildFromTemplate(
                Object.keys(presets).map((key) => {
                    return {
                        label: key,
                        click: () => renderFormInWindow(key),
                    }
                }),
            ),
        },
        {
            label: bskyAutoPostEnabled
                ? strings.menu.bskyAutoPost.enabled(bskyMeta?.handle)
                : strings.menu.bskyAutoPost.disabled,
            visible: !!bskyMeta,
            click: () =>
                APP_SETTINGS.set(
                    "settings.bskyAutoPost",
                    !APP_SETTINGS.get("settings.bskyAutoPost"),
                ),
        },
        {
            label: strings.menu.configBsky,
            enabled: !!activeProject,
            visible: !bskyMeta,
            click: () => openPageInWindow("bluesky"), // TODO re-implement
        },
    ]
}

function getSettingsMenu() {
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
    return [
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
}

function updateTrayTitle() {
    const title = projects.getActiveTitle()
    tray.setToolTip(title)

    const trayTitle = APP_SETTINGS.get("settings.showProjectTitleInMenubar")
        ? title
        : ""
    tray.setTitle(trayTitle) // only visible on mac
}

// update a single tray menu item by its ID
function updateTrayMenuItem(menuItemId, updates) {
    const menuItem = trayMenu.getMenuItemById(menuItemId)
    Object.assign(menuItem, updates) // merge updates into menu item properties
    tray.setContextMenu(trayMenu)
}

export function showUpdateNoticeInTray() {
    updateTrayMenuItem("updateAvailable", { visible: true })
}
