import { ipcMain } from "electron"
import { deployMethods, IS_PLUS_MODE, testDeployConfig } from "../../deploy.js"
import strings from "../../config/strings.js"
import { renderFormInWindow, openPageInWindow } from "../window.js"
import { Menu } from "electron"
import urls from "../../config/urls.js"
import { activeProject } from "../../index.js"
import { APP_SETTINGS, openExternalUrl, showPrompt } from "../electron.js"
import { deploy } from "../../deploy.js"

export function getDeployMenuItems() {
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
    const providerName = deployMeta?.name || deployMeta?.provider
    return [
        {
            label: strings.menu.deploy(providerName),
            visible: !!deployMeta,
            click: () => {
                // TODO project-level setting to turn off confirmation prompt?
                const clickedId = showPrompt(
                    strings.popups.confirmDeployment.message(
                        activeProject.title,
                        providerName,
                    ),
                    "warning",
                )
                if (clickedId == 0) {
                    if (
                        deployMeta.provider === "other" &&
                        !deployMeta.keyPath
                    ) {
                        // need password, so use deployment form
                        renderFormInWindow("other-password", {
                            // TODO strings.js
                            title: `deploy to ${providerName}`,
                        })
                    } else {
                        // otherwise, ready to deploy
                        deploy()
                    }
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
                deployMethods.map((method) => {
                    return {
                        label: method,
                        click: async () => {
                            const browserWindow =
                                await renderFormInWindow(method)
                            ipcMain.handle(
                                "check-deploy",
                                async (event, deployConfig) => {
                                    deployConfig.provider = deployConfig.id
                                    const result =
                                        await testDeployConfig(deployConfig)
                                    return result
                                },
                            )
                            browserWindow.on("closed", () =>
                                ipcMain.removeHandler("check-deploy"),
                            )
                        },
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
