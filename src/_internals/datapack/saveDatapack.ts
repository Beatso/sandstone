import fs from 'fs'
import path from 'path'
import {
  createDirectory, deleteDirectory, getMinecraftPath, getWorldPath,
} from './filesystem'
import packMcMeta from './packMcMeta.json'
import type {
  FunctionResource, ResourceOnlyTypeMap, ResourcesTree, ResourceTypeMap, ResourceTypes,
} from './resourcesTree'

const GRAY = '\x1b[90m'
const CYAN = '\x1b[36m'
const LIGHT_RED = '\x1b[91m'
const GREEN = '\x1b[32m'
const LIGHT_GREEN = '\x1b[92m'
const RESET = '\x1b[0m'

export type SaveOptions = {
  /**
   * The location of the `.minecraft` folder.
   * If unspecified, the location of the `.minecraft` folder will be automatically discovered.
   */
  minecraftPath?: string

  /**
   * If true, will display the resulting commands in the console.
   *
   * @default false
   */
  verbose?: boolean

  /**
   * If true, then nothing will actually be saved to the file system.
   *
   * Used with `verbose`, you can use this option to only print the results of your functions, without saving anything.
   */
  dryRun?: boolean

  /**
   * Pack description.
   */
  description?: string
} & (
    {
      /**
       * Whether to put the datapack in the .minecraft/datapacks folder, or not.
       *
       * Incompatible with the `world` parameter.
       */
      asRootDatapack?: boolean
    } | {
      /**
       * The name of the world to save the datapack in.
       * If unspecified, the datapack will be saved to the current folder.
       *
       * Incompatible with the `asRootDatapack` folder.
       */
      world?: string
    }
  )

function hasWorld(arg: SaveOptions): arg is { world: string } & SaveOptions {
  return Object.prototype.hasOwnProperty.call(arg, 'world')
}

function hasRoot(arg: SaveOptions): arg is { asRootDatapack: string } & SaveOptions {
  return Object.prototype.hasOwnProperty.call(arg, 'asRootDatapack')
}

function saveFunction(dataPath: string, resource: FunctionResource, options: SaveOptions) {
  if (resource.isResource) {
    const [namespace, ...folders] = resource.path
    const commands = resource.commands.map((args) => args.join(' '))

    const functionsPath = path.join(dataPath, namespace, 'functions')
    const fileName = folders.pop()

    const mcFunctionFolder = path.join(functionsPath, ...folders)

    if (!options.dryRun) {
      createDirectory(mcFunctionFolder)

      // Write the commands to the file system
      const mcFunctionPath = path.join(mcFunctionFolder, `${fileName}.mcfunction`)

      fs.writeFileSync(mcFunctionPath, commands.join('\n'))
    }

    const commandsRepresentation = commands.map((command) => {
      if (command.startsWith('#')) {
        return GRAY + command + RESET
      }
      return command
    }).join('\n')

    if (options.verbose) {
      console.log(`${CYAN}## Function ${namespace}:${[...folders, fileName].join('/')}${RESET}`)
      console.log(commandsRepresentation)
      console.log()
    }
  }

  Array.from(resource.children.values()).forEach((v) => saveFunction(dataPath, v, options))
}

function saveResource<T extends ResourceTypes>(
  dataPath: string,
  type: T,
  resource: ResourceTypeMap[T],
  options: SaveOptions,
  getRepresentation: (resource: ResourceOnlyTypeMap[T], consoleDisplay: boolean) => string,
  getDisplayTitle: (namespace: string, folders: string[], fileName: string) => string,
) {
  if (resource.isResource) {
    const [namespace, ...folders] = resource.path

    const basePath = path.join(dataPath, namespace, type)
    const fileName = folders.pop() as string
    const resourceFolder = path.join(basePath, ...folders)

    if (!options.dryRun) {
      createDirectory(resourceFolder)

      // Write the commands to the file system
      const resourcePath = path.join(resourceFolder, `${fileName}.${type === 'functions' ? 'mcfunction' : 'json'}`)

      fs.writeFileSync(resourcePath, getRepresentation(resource as ResourceOnlyTypeMap[T], false))
    }

    if (options.verbose) {
      console.log(`${CYAN}## ${getDisplayTitle(namespace, folders, fileName)} ${RESET}`)
      console.log(getRepresentation(resource as ResourceOnlyTypeMap[T], true))
      console.log()
    }
  }

  for (const r of resource.children.values()) {
    saveResource(dataPath, type, r as ResourceTypeMap[T], options, getRepresentation, getDisplayTitle)
  }
}

/**
 * Saves the datapack to the file system.
 *
 * @param functions A mapping between function full names and their commands.
 * @param name The name of the Datapack
 * @param options The save options.
 */
export function saveDatapack(resources: ResourcesTree, name: string, options: SaveOptions): void {
  try {
    // Start by clearing the console
    let savePath

    if (hasWorld(options)) {
      savePath = path.join(getWorldPath(options?.world, options?.minecraftPath), 'datapacks')
    } else if (hasRoot(options)) {
      savePath = path.join(getMinecraftPath(), 'datapacks/')
    } else {
      savePath = process.cwd()
    }

    savePath = path.join(savePath, name)
    const dataPath = path.join(savePath, 'data')

    if (options.description !== undefined) {
      packMcMeta.pack.description = options.description
    }

    if (!options.dryRun) {
      deleteDirectory(savePath)
      createDirectory(savePath)

      fs.writeFileSync(path.join(savePath, 'pack.mcmeta'), JSON.stringify(packMcMeta))
    }

    for (const n of resources.namespaces.values()) {
    // Save functions
      for (const f of n.functions.values()) {
        saveResource(
          dataPath, 'functions', f, options,

          // To display a function, we join their arguments. If we're in a console display, we put comments in gray.
          (func, consoleDisplay) => {
            const repr = func.commands.map((command) => command.join(' ')).join('\n')
            if (consoleDisplay) {
              return repr.replace(/^#(.+)/gm, `${GRAY}#$1${RESET}`)
            }

            return repr
          },
          (namespace, folders, fileName) => `Function ${namespace}:${[...folders, fileName].join('/')}`,
        )
      }

      // Save tags
      for (const t of n.tags.values()) {
        saveResource(
          dataPath, 'tags', t, options,
          (r) => JSON.stringify({ replace: r.replace ?? false, values: r.values }, null, 2),
          (namespace, folders, fileName) => `Tag[${folders[0]}] ${namespace}:${[...folders.slice(1), fileName].join('/')}`,
        )
      }

      // Save advancements
      for (const a of n.advancements.values()) {
        saveResource(dataPath, 'advancements', a, options,
          (r) => JSON.stringify(r.advancement, null, 2),
          (namespace, folders, fileName) => `Avancement ${namespace}:${[...folders, fileName].join('/')}`)
      }

      // Save predicates
      for (const p of n.predicates.values()) {
        saveResource(
          dataPath, 'predicates', p, options,
          (r) => JSON.stringify(r.predicate, null, 2),
          (namespace, folders, fileName) => `Predicate ${namespace}:${[...folders, fileName].join('/')}`,
        )
      }

      // Save loot tables
      for (const l of n.loot_tables.values()) {
        saveResource(
          dataPath, 'loot_tables', l, options,
          (r) => JSON.stringify(r.lootTable, null, 2),
          (namespace, folders, fileName) => `Loot table ${namespace}:${[...folders, fileName].join('/')}`,
        )
      }

      // Save recipe
      for (const r of n.recipe.values()) {
        saveResource(
          dataPath, 'recipe', r, options,
          (resource) => JSON.stringify(resource.recipe, null, 2),
          (namespace, folders, fileName) => `Recipe ${namespace}:${[...folders, fileName].join('/')}`,
        )
      }
    }

    if (!options.dryRun) {
      console.log(`${LIGHT_GREEN}✓ Successfully wrote datapack to "${savePath}"${RESET}`)
    }
  } catch (e) {
    console.log(`${LIGHT_RED}✗ Failed to write datapack. See above for additional information.${RESET}`)
  }
}