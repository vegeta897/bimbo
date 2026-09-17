import * as fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"
import winston from "winston"
import { parse as yamlParse, stringify as yamlStringify } from "yaml"

import config from "./config/index.js"
import strings from "./config/strings.js"
import { PROJECT_CONFIG_OPTIONS } from "./front-matter.js"

global.logger = winston.createLogger({
    level: "info",
    format: winston.format.json(),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.simple(),
                winston.format.colorize({ all: true }),
            ),
        }),
    ],
})

export let activeProject = null

// TODO could accept path instead?
export const setActiveProject = function (project) {
    activeProject = project
}

export async function getProjectStarters() {
    const projectStartersPaths = {}
    const starterDirs = await fs.readdir(config.PROJECT_STARTERS_PATH, {
        withFileTypes: true,
    })
    starterDirs.forEach((dirent) => {
        if (dirent.isDirectory()) {
            projectStartersPaths[dirent.name] = path.join(
                dirent.parentPath,
                dirent.name,
            )
        }
    })
    return projectStartersPaths
}

export async function createNewProject(destinationPath, starter) {
    const starterPath = path.join(config.PROJECT_STARTERS_PATH, starter)
    if (!existsSync(starterPath)) {
        logger.error(`path not found for starter "${starter}"`)
        return
    }
    await fs.cp(starterPath, destinationPath, {
        recursive: true,
    })

    await Promise.all(
        config.EXTRA_INIT_FILES.map(async (data) => {
            const subpath = path.dirname(data.filePath)

            if (data.json) {
                data.text = JSON.stringify(data.json, null, true)
            }

            if (subpath) {
                await fs.mkdir(path.join(destinationPath, subpath), {
                    recursive: true,
                })
            }

            await fs.writeFile(
                path.join(destinationPath, data.filePath),
                data.text,
            )
        }),
    )

    const NEW_PROJECT = new Project(destinationPath)

    NEW_PROJECT.updateConfig({
        globals: {
            title: path.basename(destinationPath),
        },
    })
}

export class Project {
    paths

    constructor(rootPath) {
        this.paths = Object.fromEntries(
            Object.entries(config.PROJECT_PATHS).map(
                ([pathKey, relativePath]) => [
                    pathKey,
                    path.join(rootPath, relativePath),
                ],
            ),
        )

        if (!existsSync(this.paths.CONFIG_FILE)) {
            return Error(`${this.paths.CONFIG_FILE} does not exist`)
        }
    }

    get config() {
        return readConfigFile(this.paths.CONFIG_FILE)
    }
    async updateConfig(data) {
        await updateConfigFile(this.paths.CONFIG_FILE, data)
    }

    get secrets() {
        return readConfigFile(this.paths.SECRETS_FILE)
    }
    async updateSecrets(data) {
        await updateConfigFile(this.paths.SECRETS_FILE, data)
    }

    get globals_meta() {
        return this.config[PROJECT_CONFIG_OPTIONS.GLOBALS.name]
    }
    get defaults_meta() {
        return this.config[PROJECT_CONFIG_OPTIONS.DEFAULTS.name]
    }
    get validators_meta() {
        return this.config[PROJECT_CONFIG_OPTIONS.VALIDATORS.name]
    }
    get collections_meta() {
        return this.config[PROJECT_CONFIG_OPTIONS.COLLECTIONS.name]
    }

    get title() {
        return this.globals_meta.title || "untitled project"
    }
}

function readConfigFile(filepath) {
    return existsSync(filepath) ? parseYamlFile(filepath) : {}
}

async function updateConfigFile(filepath, newData = {}) {
    const configData = existsSync(filepath) ? parseYamlFile(filepath) : {}

    await fs.writeFile(filepath, yamlStringify({ ...configData, ...newData }))

    const UPDATED_KEYS = Object.keys(newData)
    logger.info(strings.logMsg.userConfigSaved(filepath, UPDATED_KEYS))
    return UPDATED_KEYS
}

function parseYamlFile(filepath) {
    return yamlParse(readFileSync(filepath, "utf-8"))
}
