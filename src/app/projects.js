import { existsSync } from "fs"
import { join as pathJoin } from "node:path"

import config from "../config/index.js"
import { activeProject, Project } from "../index.js"
import { watch } from "../site-generator.js"
import { APP_SETTINGS, showMessageBox, showNotification } from "./electron.js"
import strings from "../config/strings.js"
import { setActiveProject } from "../index.js"

const exports = {
    get activeIndex() {
        return APP_SETTINGS.get("activeIndex")
    },
    set activeIndex(value) {
        APP_SETTINGS.set("activeIndex", value)

        if (this.activeIndex > -1) {
            setActiveProject(new Project(this.list[this.activeIndex]))
            watch(true)
        } else {
            setActiveProject(null)
        }
    },
    getActiveTitle() {
        return activeProject?.title || strings.projects.notLoaded
    },
    get list() {
        return APP_SETTINGS.get("projects")
    },
    set list(value) {
        APP_SETTINGS.set("projects", value)
    },
    initialize() {
        const cleanedList = []
        let newActiveIndex = this.activeIndex

        this.list.forEach((projectPath, index) => {
            const projectExists = existsSync(
                pathJoin(projectPath, config.PROJECT_PATHS.CONFIG_FILE),
            )
            if (projectExists) {
                cleanedList.push(projectPath)
                return
            }
            logger.warn(strings.logMsg.missingProject(projectPath))
            showMessageBox(strings.projects.missing(projectPath))
            // if removing this project offsets the active index, shift it
            if (index <= this.activeIndex) {
                newActiveIndex--
            }
        })
        this.list = cleanedList
        // set active project to last if index out of bounds
        // this should never actually occur, but
        if (newActiveIndex >= this.list.length) {
            newActiveIndex = this.list.length - 1
        }
        // unload if no projects in list
        if (cleanedList.length === 0) {
            newActiveIndex = -1
        }
        this.activeIndex = newActiveIndex // this loads the project
    },
    getFromPath(rootPath) {
        return new Project(rootPath)
    },
    add(newPath) {
        let projectsList = this.list

        if (projectsList.includes(newPath)) {
            showNotification(strings.projects.alreadyImported)
            return
        }

        projectsList.push(newPath)
        this.list = projectsList

        return this.list.length - 1
    },
}

export default exports
