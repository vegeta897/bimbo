import * as path from "node:path"
import * as fs from "node:fs/promises"
import { existsSync } from "node:fs"

import _ from "lodash"
import { parse as yamlParse } from "yaml"
// import moment from "moment"
import { Feed } from "feed"
// import * as cheerio from "cheerio"
// import * as feather from "feather-icons"
import { createServer } from "vite"
import chokidar from "chokidar"
import { readingTime } from "reading-time-estimator"

import { activeProject } from "./index.js"
import config from "./config/index.js"
import strings from "./config/strings.js" // TODO export separate categories? (e.g. {generator} from strings)
import {
    // queuePost,
    // setupDomainVerification,
    arePostsQueued,
    submitQueuedPosts,
    // resolveHandle,
} from "./bluesky/main.js"
import { compile, getFrontMatterFromFile, renderMdToHtml } from "./templater.js"

let server
let watcher

let buildData

// TODO use helper functions in templater.js
export async function build(isPostDeploy = false) {
    logger.info(strings.generator.buildStart(isPostDeploy))

    const projectPaths = activeProject.paths

    // quit if content folder is missing
    // TODO probably other required folders to check for
    if (!existsSync(projectPaths.CONTENT)) {
        logger.info(strings.generator.missingContentFolder)
        // TODO showMessageBox() // return error (to app or main)
        return
    }

    buildData = { _pages: [], _data: {}, collections: {} }

    // delete previous build
    if (existsSync(projectPaths.OUTPUT)) {
        await fs.rm(projectPaths.OUTPUT, {
            recursive: true,
            force: true,
            maxRetries: 10, // sometimes files are temporarily locked
        })
    }
    await fs.mkdir(projectPaths.OUTPUT)

    if (existsSync(projectPaths.DATA)) {
        // TODO - find out why i'm using promise readdir sometimes
        const dataFilepaths = await fs.readdir(projectPaths.DATA, {
            recursive: true,
        })

        await Promise.all(
            dataFilepaths.map(async (filepath) => {
                const rawData = await fs.readFile(
                    path.join(projectPaths.DATA, filepath),
                    "utf-8",
                )
                const dataName = path.basename(filepath, path.extname(filepath))

                // TODO clean this up
                try {
                    if (path.extname(filepath) == ".json") {
                        buildData._data[dataName] = JSON.parse(rawData)
                    }
                    if (path.extname(filepath) == ".yaml") {
                        buildData._data[dataName] = yamlParse(rawData)
                    }
                    if (path.extname(filepath) == ".txt") {
                        buildData._data[dataName] = rawData.split("\n")
                    }
                    // eslint-disable-next-line no-unused-vars
                } catch (e) {
                    logger.warn("failed to parse data from " + dataName) // TODO string
                }
            }),
        )
    }

    const contentPaths = await fs.readdir(projectPaths.CONTENT, {
        recursive: true,
    })
    for (const contentPath of contentPaths) {
        if (path.extname(contentPath) !== config.CONTENT_EXTENSION) {
            continue
        }
        const pageMeta = await getPageData(contentPath)
        if (pageMeta) {
            buildData._pages.push(pageMeta)
        }
    }

    if (isPostDeploy && arePostsQueued()) {
        await processBlueskyPosts()
    }

    activeProject.collections_meta.forEach((ruleset) => {
        const collectionName = config.PAGE_GROUP_PREFIX + ruleset.name

        buildData.collections[collectionName] = buildData._pages
        ruleset.filter?.forEach((filter) => {
            buildData.collections[collectionName] = buildData.collections[
                collectionName
            ].filter((page) =>
                filter.value
                    ? page[filter.key] === filter.value
                    : page[filter.key],
            )
        })

        ruleset.sort?.forEach((sort) => {
            buildData.collections[collectionName] = _.sortBy(
                buildData.collections[collectionName],
                (v) => v[sort.key],
            )

            if (sort.order === "descending") {
                buildData.collections[collectionName].reverse()
            }
        })

        ruleset.group?.forEach((group) => {
            // TODO defining the values and then assigning pages to them can be done in one iteration
            const groupValues = new Set(
                buildData.collections[collectionName]
                    .flatMap((collection) => collection[group.key])
                    .filter((v) => v),
            )

            const pageGroups = {}

            groupValues.forEach((groupValue) => {
                pageGroups[groupValue] = buildData.collections[
                    collectionName
                ].filter((page) => {
                    const pageValue = page[group.key]

                    if (!pageValue) {
                        return
                    }

                    if (Array.isArray(pageValue)) {
                        return pageValue.includes(groupValue)
                    } else {
                        return pageValue === groupValue
                    }
                })
            })

            buildData.collections[collectionName] = pageGroups
        })

        // add references to prev/next page to all pages
        // TODO only do this if collection is marked as a "series"
        // it doesn't really have a purpose in navPages or grouped collections
        let nextPage
        let previousPage
        Object.keys(buildData.collections[collectionName]).forEach((key) => {
            // note, "next" and "previous" are reversed in the direction of this loop
            if (nextPage) {
                buildData.collections[collectionName][key]._nextPage = nextPage
            }
            nextPage = buildData.collections[collectionName][key]
            if (previousPage) {
                previousPage._previousPage =
                    buildData.collections[collectionName][key]
            }
            previousPage = buildData.collections[collectionName][key]
        })
    })

    // TODO do something with snippets idk
    if (existsSync(projectPaths.SNIPPETS)) {
        const snippets = await fs.readdir(projectPaths.SNIPPETS)
        buildData._snippets = Object.fromEntries(
            await Promise.all(
                snippets.map(async (snippetPath) => {
                    const key = path.basename(snippetPath, ".md")
                    const mdContent = await fs.readFile(
                        path.join(projectPaths.SNIPPETS, snippetPath),
                        "utf-8",
                    )
                    return [key, renderMdToHtml(mdContent)]
                }),
            ),
        )
    }

    await Promise.all(
        buildData._pages.map(async (pageMeta) => await generatePage(pageMeta)),
    )

    const rssCollectionName = activeProject.collections_meta.find(
        (g) => g.rss,
    )?.name

    if (rssCollectionName) {
        await generateRssFeed(config.PAGE_GROUP_PREFIX + rssCollectionName)
    }

    // copy static pages
    await fs.cp(
        projectPaths.STATIC,
        path.join(projectPaths.OUTPUT, config.PROJECT_PATHS.STATIC),
        { recursive: true },
        (err) => {
            if (err) {
                logger.error(err)
            }
        },
    )

    // TODO move this stuff out
    const bskyHandle = buildData.integrations?.bluesky?.handle
    // const bskyUserId = buildData.integrations?.bluesky?.userId

    if (bskyHandle) {
        // TODO never exists bc _site gets wiped every build
        // if (!existsSync(path.join(getJoinedPath(config.PROJECT_PATHS.OUTPUT), '.well-known/atproto-did'))) {
        //     try {
        //         await setupDomainVerification(bskyHandle, getJoinedPath(config.PROJECT_PATHS.OUTPUT))
        //     } catch (err) {
        //         logger.warn(
        //             strings.generator.bsky.domainVerification.fail(bskyHandle),
        //         )
        //         logger.warn(err)
        //     }
        // }
    }

    logger.info(strings.generator.buildComplete(isPostDeploy))

    // TODO this is autoOpenPreview now and probably goes elsewhere
    // if (APP_SETTINGS.get("settings.openPreviewOnChange")) {
    //     openBrowserPreview()
    // }
}

let lastProjectMeta

// TODO move watch into main
export async function watch(initialBuild = false) {
    // TODO bug: one time, a .vite folder got stuck in _site ?
    if (watcher) {
        await watcher.close()
    }
    if (server) {
        await server.close()
    }

    if (activeProject) {
        const PROJECT_PATHS = activeProject.paths
        lastProjectMeta = activeProject.config

        watcher = chokidar
            .watch(PROJECT_PATHS.ROOT, {
                ignored: (filePath) => {
                    return (
                        PROJECT_PATHS.OUTPUT == path.normalize(filePath) ||
                        [".git", ".gitignore", ".DS_Store"].includes(
                            path.basename(filePath),
                        ) ||
                        filePath.includes(".vscode/settings.json") // TODO read this (and .gitignore) from config const
                    )
                },
                ignoreInitial: true,
            })
            .on("all", (event, changedPath) => {
                logger.info(`${event}: ${changedPath}`)

                if (
                    path.basename(changedPath) ==
                        config.PROJECT_PATHS.SECRETS_FILE &&
                    _.isEqual(activeProject.config, lastProjectMeta)
                ) {
                    return
                }

                lastProjectMeta = activeProject.config // TODO move this into build?
                build()
            })

        logger.info(strings.generator.monitoring(PROJECT_PATHS.ROOT))

        server = await createServer({
            configFile: false,
            root: activeProject.paths.OUTPUT,
            publicDir: false,
            logLevel: "silent",
            server: {
                port: config.VITE_PORT,
                strictPort: true,
            },
        })
        await server.listen()
        logger.info(strings.app.server(config.VITE_PORT))

        if (initialBuild) {
            build()
        }
    }
}

export async function pauseWatcher() {
    if (watcher) {
        logger.info(strings.app.pauseWatcher)
        await watcher.close()
        watcher = null
    }
}

async function getPageData(contentPath) {
    const projectPaths = activeProject.paths
    const absolutePath = path.join(projectPaths.CONTENT, contentPath)
    const frontMatter = await getFrontMatterFromFile(absolutePath)

    const pageMeta = {
        _filepath: absolutePath,
        _subfolder: path.dirname(contentPath),
        _relativeUrl:
            "/" +
            contentPath.replace(
                config.CONTENT_EXTENSION,
                config.PAGE_EXTENSION,
            ),
        _mdContent: frontMatter,
        // _content added in generatePage()
    }

    const contentDefaults = _.omit(activeProject.defaults_meta, "subfolders")
    const subfolderDefaults =
        activeProject.defaults_meta?.subfolders[pageMeta._subfolder] || {}

    _.merge(
        pageMeta, // base object with generated values
        contentDefaults, // project-wide default values
        subfolderDefaults, // subfolder-specific default values
        frontMatter.attributes, // page-specific values
    )

    pageMeta.readingTime = readingTime(frontMatter.body).text

    // TODO validators
    if (pageMeta.draft) {
        logger.info(strings.generator.skipDraft(contentPath))
        return
    }

    // use filename as title if not defined
    if (!pageMeta.title) {
        pageMeta.title = path.basename(contentPath, config.CONTENT_EXTENSION)
    }

    if (pageMeta.redirect) {
        pageMeta._relativeUrl = pageMeta.redirect
    }

    // const $ = cheerio.load(pageMeta._content)

    // if (!pageMeta.description) {
    //     // TODO make this smarter
    //     pageMeta.description = $("p").html()
    // }

    // let firstImgUrl = $("img").prop("src")

    // TODO figure this junk out
    // if (!pageMeta.headerImage) {
    //     pageMeta.headerImage = firstImgUrl || buildData.site.headerImage
    // }

    // pageMeta.headerImageLocal = pageMeta.headerImage

    // if (pageMeta.headerImage && path.parse(pageMeta.headerImage).root == "/") {
    //     pageMeta.headerImage = new URL(
    //         pageMeta.headerImage,
    //         "https://" + buildData.site.url,
    //     ).href
    // }

    return pageMeta
}

async function generatePage(pageMeta) {
    const projectPaths = activeProject.paths

    if (pageMeta.redirect) {
        return
    }

    pageMeta.globals = activeProject.globals_meta
    pageMeta._content = renderMdToHtml(pageMeta._mdContent.body)
    pageMeta._project_meta = activeProject.config // TODO _project_config?
    pageMeta._data = buildData._data // TODO not sure if this is best way to do this
    pageMeta._snippets = buildData._snippets // review all of this lol
    Object.assign(pageMeta, buildData.collections) // TODO not sure if still works?

    if (!pageMeta.template) {
        pageMeta.template = path.basename(pageMeta._filepath, ".md") + ".hbs"
    }

    const templatePath = path.join(projectPaths.TEMPLATES, pageMeta.template)

    // get html template
    if (!existsSync(templatePath)) {
        logger.warn(strings.generator.missingTemplate)
        return // TODO missing template handling (skip page?)
    }

    const htmlPath = pageMeta._relativeUrl
    const outputPath = path.dirname(htmlPath)

    if (!existsSync(outputPath)) {
        // TODO catch potential permission errors
        await fs.mkdir(path.join(projectPaths.OUTPUT, outputPath), {
            recursive: true,
        })
    }

    await fs.writeFile(
        path.join(projectPaths.OUTPUT, htmlPath),
        await compile(templatePath, pageMeta, projectPaths.PARTIALS),
    )

    // TODO auto post should be project-level setting
    // queue bluesky post for after deploy
    // if (
    //     APP_SETTINGS.get("settings.bskyAutoPost") &&
    //     pageMeta.bskyPostId == "tbd"
    // ) {
    //     queuePost(pageMeta)
    // }
}

async function processBlueskyPosts() {
    await pauseWatcher()
    const { userId } = activeProject.secrets.integrations.bluesky
    const skeetsPosted = await submitQueuedPosts()

    // TODO test
    skeetsPosted.forEach(({ path, id }) => {
        const pageMeta = buildData._pages.find(
            (page) => (page._filepath = path),
        )

        pageMeta.bskyPostId = id

        fs.writeFile(
            pageMeta._filepath,
            pageMeta._mdContent.replace("bskyPostId: tbd", `bskyPostId: ${id}`), // TODO feels kinda hacky
        )

        logger.info(
            strings.generator.bsky.postSuccess(
                `https://bsky.app/profile/${userId}/post/${id}`,
            ),
        )
    })
}

async function generateRssFeed(groupName) {
    const PROJECT_GLOBALS = activeProject.globals_meta

    const RSS_FEED = new Feed({
        title: PROJECT_GLOBALS.title,
        description: PROJECT_GLOBALS.description,
        id: PROJECT_GLOBALS.url, // TODO dynamic url get?
        link: PROJECT_GLOBALS.url, // TODO dynamic url get?
        author: {
            // TODO support for multiple authors
            name: PROJECT_GLOBALS.author.name,
            email: PROJECT_GLOBALS.author.email,
            link: PROJECT_GLOBALS.author.url,
        },
    })

    _.each(buildData.collections[groupName], (pageMeta) => {
        if (!pageMeta.excludeFromRss) {
            try {
                RSS_FEED.addItem({
                    title: pageMeta.title,
                    description: pageMeta.description,
                    id: pageMeta._relativeUrl,
                    link: pageMeta._relativeUrl,
                    date: pageMeta.date,
                    content: pageMeta._content,
                    author: {
                        // TODO support for multiple authors
                        name: PROJECT_GLOBALS.author.name,
                        email: PROJECT_GLOBALS.author.email,
                        link: PROJECT_GLOBALS.author.url,
                    },
                })
            } catch (err) {
                logger.info(strings.generator.rssFail)
                logger.info(err)
            }
        }
    })

    await fs.writeFile(
        path.join(activeProject.paths.OUTPUT, "feed.xml"),
        RSS_FEED.rss2(),
    )
}
