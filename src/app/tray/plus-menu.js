import { presets, IS_PLUS_MODE } from "../../deploy.js"
import strings from "../../config/strings.js"
import { renderFormInWindow, openPageInWindow } from "../window.js"
import { Menu } from "electron"
import urls from "../../config/urls.js"
import { activeProject } from "../../index.js"
import { APP_SETTINGS, openExternalUrl, showPrompt } from "../electron.js"
import { deploy } from "../../deploy.js"

export function getPlusModeItems() {
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
