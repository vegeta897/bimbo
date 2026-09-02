import * as path from "node:path"
import * as fs from "node:fs"
import { NeocitiesAPIClient } from "async-neocities"
import NekowebAPI from "@indiefellas/nekoweb-api"
import SftpClient from "ssh2-sftp-client"
import { zip } from "zip-a-folder"
import strings from "./config/strings.js"
// import { arePostsQueued } from "./bluesky/main.js"
import { pauseWatcher, watch } from "./site-generator.js"
import { activeProject } from "./index.js"

export const IS_PLUS_MODE = true

export const deployMethods = ["nekoweb", "neocities", "other"]

export async function deploy(ephemeral = {}) {
    logger.info(strings.logMsg.deployStart)

    await pauseWatcher()

    // merge saved deployment meta and ephemeral properties into a new object
    const deployConfig = {
        ...activeProject.secrets.deployment,
        ...ephemeral,
    }

    let result
    const startMsg = strings.deployment.start(deployConfig.provider)
    logger.info(startMsg)
    // TODO how to surface these to electron
    // vegeta: do it in the place(s) that call deploy()
    // showNotification(startMsg)

    switch (deployConfig.provider) {
        case "nekoweb":
            result = await deployToNekoweb(deployConfig)
            break
        case "neocities":
            result = await deployToNeocities(deployConfig)
            break
        case "other":
            result = await deployViaSftp(deployConfig)
            break
        default:
            break
    }

    let resultMsg = result.success
        ? strings.deployment.finish.success()
        : strings.deployment.finish.fail
    logger.info(resultMsg)
    // showNotification(resultMsg)

    // TODO should be set at project level (in secrets?)
    // if (success) {
    //     if (APP_SETTINGS.get("settings.bskyAutoPost") && !isPostDeploy) {
    //         await postDeploy()
    //     }
    // }

    watch()
}

export async function testDeployConfig(deployConfig) {
    switch (deployConfig.provider) {
        case "nekoweb":
            return await deployToNekoweb(deployConfig, true)
        case "neocities":
            return await deployToNeocities(deployConfig, true)
        case "other":
            return await deployViaSftp(deployConfig, true)
    }
}

export async function getNeocitiesApiKey(username, password) {
    // TODO this will fail on a fresh account that hasn't yet made any changes to their site
    // actual error message: "stale account - make a change through the UI to sign in this way"
    // i had to make a change to my site via their web UI to fix this
    const response = await NeocitiesAPIClient.getKey({
        siteName: username,
        ownerPassword: password,
    })

    if (response.result === "success") {
        logger.info(strings.deployment.auth.success("neocities"))

        return response.api_key
    } else {
        logger.info(strings.deployment.auth.fail("neocities"))

        return null
    }
}

async function deployToNeocities(deployConfig, testOnly = false) {
    const result = { success: false }
    try {
        if (!deployConfig.apiKey) {
            const apiKey = await getNeocitiesApiKey(
                deployConfig.username,
                deployConfig.password,
            )
            if (!apiKey) {
                throw "invalid username or password"
            }
            deployConfig.apiKey = apiKey
        }
        const client = new NeocitiesAPIClient(deployConfig.apiKey)

        if (testOnly) {
            const siteInfo = await client.info()
            result.success = siteInfo.result === "success"
        } else {
            // TODO bug: static folder not being uploaded
            // maybe only happens on first attempt?
            const deployResult = await client.deploy({
                directory: activeProject.paths.OUTPUT,
                cleanup: true, // Delete orphaned files
                includeUnsupportedFiles: false, // TODO - atproto-did unsupported, paid feature
            })
            logger.info(JSON.stringify(deployResult))
            result.success = deployResult.results[0].body.result == "success"
        }
    } catch (err) {
        logger.error(err)
        result.message = `${err}`
    }
    return result
}

async function deployToNekoweb(deployConfig, testOnly) {
    const result = { success: false }
    const nekoweb = new NekowebAPI({
        apiKey: deployConfig.apiKey,
        logging: (logType, logMessage) => logger.info(logMessage), // TODO use logType? https://github.com/indiefellas/nekoweb-api/blob/main/src/types.ts
    })

    const sitePath = activeProject.paths.OUTPUT
    const zipPath = path.join(activeProject.paths.ROOT, "upload.zip")

    try {
        await nekoweb.getSiteInfo(deployConfig.domain)
        result.success = true
    } catch {
        logger.error(strings.deployment.nekowebSiteInfoFail)
        result.message = strings.deployment.nekowebSiteInfoFail
    }
    if (testOnly) {
        return result
    }
    result.success = false
    try {
        await zip(sitePath, zipPath) // TODO can we get as buffer?
        const bigfile = await nekoweb.createBigFile()
        const zipFile = fs.readFileSync(zipPath)
        await bigfile.append(zipFile)
        // Delete and recreate domain root to clean up old files
        await nekoweb.delete("/" + deployConfig.domain)
        await nekoweb.create("/" + deployConfig.domain, true)
        const response = await bigfile.import("/" + deployConfig.domain)

        fs.rmSync(zipPath)

        // TODO atproto thing not uploading - need to do separately?
        // let atfile = fs.readFileSync(path.join(sitePath, '.well-known/atproto-did'))
        // await nekoweb.upload('/.well-known/atproto-did', atfile)
        result.success = response === "Imported"
    } catch (err) {
        logger.error(err)
        result.message = `${err}`
    }
    return result
    // try {
    // }
    // catch(err) {
    // 	logger.error(err) // TODO returns undefined
    // 	return false
    // }
}

async function deployViaSftp(deployConfig, testOnly = false) {
    const result = { success: false }
    const client = new SftpClient()
    const sitePath = activeProject.paths.OUTPUT

    try {
        const connectConfig = {
            host: deployConfig.host,
            username: deployConfig.username,
        }
        if (deployConfig.port) connectConfig.port = deployConfig.port
        if (deployConfig.password)
            connectConfig.password = deployConfig.password
        if (deployConfig.keyPath)
            connectConfig.privateKey = fs.readFileSync(
                deployConfig.keyPath,
                "utf-8",
            )
        await client.connect(connectConfig)
        if (testOnly) {
            await client.list(".")
        } else {
            await client.rmdir(deployConfig.siteRoot, true).catch(() => {}) // Fail silently if dir doesn't exist
            await client.uploadDir(sitePath, deployConfig.siteRoot)
        }
        result.success = true
    } catch (err) {
        logger.error(err.message)
        result.message = err.message || `${err}`
    }
    client.end()
    return result
}

// TODO make a better pattern for this
// async function postDeploy() {
//     if (arePostsQueued()) {
//         logger.info(strings.deployment.queuedPosts)
//         await build(true)
//         await deploy(true)
//     }
// }
