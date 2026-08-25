import * as path from "node:path"
import { platform } from "node:os"

import winston from "winston"
import { app, globalShortcut, ipcMain } from "electron"

import {
    APP_SETTINGS,
    openExternalUrl,
    showMessageBox,
    LOG_PATH,
} from "./electron.js"
import config from "../config/index.js"
import projects from "./projects.js"
import { deploy, getNeocitiesApiKey } from "../deploy.js"
import strings from "../config/strings.js"
import urls from "../config/urls.js"
import { build } from "../site-generator.js"
import { resolveHandle as resolveBlueskyHandle } from "../bluesky/main.js"
import { createNewProject, activeProject } from "../index.js"
import { checkVersion, CURRENT_VERSION } from "./version.js"
import {
    initializeTray,
    rebuildTray,
    showUpdateNoticeInTray,
} from "./tray/index.js"
import { configureCrashReporting } from "./bugsplat.js"

configureCrashReporting()

app.whenReady().then(() => {
    logger.add(
        new winston.transports.File({
            filename: LOG_PATH,
            handleRejections: true,
            humanReadableUnhandledException: true,
        }),
    )

    logger.info(strings.logMsg.logPath(LOG_PATH))
    logger.info(strings.app.titleWithVersion(CURRENT_VERSION))

    // hide dock icon on mac
    if (platform() === "darwin") {
        app.dock.hide()
    }

    projects.initialize()

    initializeTray()

    globalShortcut.register("CommandOrControl+Alt+R", clearConfig)

    // keeps app open with no real windows
    app.on("window-all-closed", () => {})

    if (projects.activeIndex == -1 && !config.DEV_MODE) {
        openExternalUrl(urls.tutorial)
    }

    checkVersion(showUpdateNoticeInTray)

    logger.info(strings.logMsg.ready)
})

// redirect navigation and new windows to user's browser instead
app.on("web-contents-created", (event, contents) => {
    // prevents navigation within BrowserWindow
    contents.on("will-navigate", (event, navigationUrl) => {
        event.preventDefault()
        openExternalUrl(navigationUrl)
    })
    // prevents new BrowserWindow opening
    contents.setWindowOpenHandler(({ url }) => {
        openExternalUrl(url)
        return { action: "deny" }
    })
})

export function clearConfig() {
    logger.info(strings.logMsg.configClearTry)
    APP_SETTINGS.clear()
    projects.activeIndex = -1
    rebuildTray()
    showMessageBox(strings.app.configClear)
    logger.info(strings.logMsg.configClearSuccess)
}

ipcMain.on("form", async function (event, formData) {
    if (event.senderFrame.origin !== "file://") {
        logger.warn(
            `received form submission from external URL ${event.senderFrame.url}`,
        )
        return
    }

    if (formData.id === "new-project") {
        handleNewProjectForm(formData)
    } else if (formData.formType === "deploy") {
        handleDeployForm(formData)
    } else {
        logger.warn(
            `unknown form id "${formData.id}" with type "${formData.formType}"`,
        )
    }
})

function handleNewProjectForm(formData) {
    // TODO validate project title as valid folder name
    const destinationPath = path.join(formData.projectRoot, formData.title)

    // TODO throw error if fails
    createNewProject(destinationPath, formData.starter)

    projects.activeIndex = projects.add(destinationPath)

    rebuildTray()
}

async function handleDeployForm(formData) {
    let newSecrets = {}

    switch (formData.id) {
        case "nekoweb":
            newSecrets = {
                deployment: {
                    provider: formData.id,
                    domain: formData.domain,
                    apiKey: formData.apiKey,
                },
            }
            break
        case "neocities": {
            const API_KEY = await getNeocitiesApiKey(
                formData.username,
                formData.password,
            ) // TODO no css?

            if (!API_KEY) {
                showMessageBox(strings.popups.deployFail(formData.id), "error")
            }

            newSecrets = {
                deployment: {
                    provider: formData.id,
                    apiKey: API_KEY,
                },
            }
            break
        }
        case "other":
            newSecrets = {
                deployment: {
                    provider: formData.id,
                    host: formData.host,
                    port: formData.port,
                    siteRoot: formData.siteRoot,
                    username: formData.username,
                    password: formData.password, // TODO never save passwords
                    // TODO keypath
                },
            }
            break
        case "bluesky":
            newSecrets = {
                integrations: {
                    bluesky: {
                        handle: formData.handle, // TODO do we need this? will it break if changed?
                        userId: await resolveBlueskyHandle(formData.handle),
                        appPassword: formData.appPassword,
                    },
                },
            }
            break
        default:
            break
    }

    activeProject.updateSecrets(newSecrets)

    if (newSecrets.deployment) {
        // TODO oh god test this before shipping
        await build() // .then?

        // await setTimeout(1000) // HACK to get around build not finishing in time for deploy

        try {
            deploy()
        } catch (err) {
            logger.error(err)
        }
    }
}
