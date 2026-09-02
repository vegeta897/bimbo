import * as path from "node:path"
import { dialog, ipcMain } from "electron"
import projects from "../projects.js"
import strings from "../../config/strings.js"
import { APP_PATH, handlePickDirectory } from "../electron.js"
import { getProjectStarters } from "../../index.js"
import { rebuildTray } from "./index.js"
import { openPageInWindow } from "../window.js"

export function getProjectsMenu() {
    const submenu = [
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
                    rebuildTray()
                },
            }
        }),
        { type: "separator" },
        {
            label: strings.menu.projects.create,
            click: async () => {
                const browserWindow = await openPageInWindow("new-project")
                // Send list of starters to form
                // TODO use the data argument for this!
                // or have the page invoke a request for it
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
    return {
        label: projects.getActiveTitle(),
        type: "submenu",
        submenu,
    }
}
