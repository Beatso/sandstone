import { LiteralUnion } from '@/generalTypes'
import { CommandsRoot } from '@commands'
import type { ObjectiveClass } from '@variables'
import { saveDatapack, SaveOptions } from './filesystem'
import { CommandArgs, toMcFunctionName } from './minecraft'
import { FunctionResource, ResourcePath, ResourcesTree } from './resourcesTree'

export interface McFunctionReturn<T extends unknown[]> {
  (...args: T): void

  schedule: (delay: number | LiteralUnion<'1t' | '1s' | '1d'>, type: 'append' | 'replace', ...callbackArgs: T) => void
}

export default class Datapack {
  defaultNamespace: string

  currentFunction: FunctionResource | null

  resources: ResourcesTree

  objectives: Map<string, ObjectiveClass>

  commandsRoot: CommandsRoot

  constants: Set<number>

  constructor(namespace: string) {
    this.defaultNamespace = namespace
    this.currentFunction = null
    this.resources = new ResourcesTree()
    this.objectives = new Map()
    this.constants = new Set()

    this.commandsRoot = new CommandsRoot(this)
  }

  getFunctionAndNamespace(functionName: string): ResourcePath {
    let namespace = this.defaultNamespace
    let name = functionName

    if (functionName.includes(':')) {
      ([namespace, name] = functionName.split(':'))
    }

    return [namespace, name]
  }

  /**
   * Creates and enters a new root Minecraft function.
   *
   * @param functionName The name of the function to create
   */
  private createEnterRootFunction(functionName: string): ResourcePath {
    const functionFullPath = this.getFunctionAndNamespace(functionName)

    this.currentFunction = this.resources.addResource('functions', {
      children: new Map(), commands: [], isResource: true, path: functionFullPath,
    })

    return functionFullPath
  }

  /**
   * Returns a unique name for a function, from an original name, by checking if it already exists in the given folder.
   * @param functionName the original name for the function.
   * @param folder the folder to check into.
   */
  private getUniqueNameFromFolder(functionName: string, folder: FunctionResource): string {
    let newName = functionName

    const newNameTemplate = `${newName}_{}`
    let i = 2

    // If the current "new name" already exists in the Datapack, increment `i` and apply the template
    while (folder.children.has(newName)) {
      newName = newNameTemplate.replace('{}', i.toString())
      i += 1
    }

    return newName
  }

  /**
   * Get a unique name for a child function of the current function, from an original name.
   * @param childName The original name for the child function.
   */
  private getUniqueChildName(childName: string): string {
    if (!this.currentFunction) {
      throw new Error('Trying to get a unique child name outside a root function.')
    }

    return this.getUniqueNameFromFolder(childName, this.currentFunction)
  }

  /**
   * Creates a new child function of the current function.
   * @param functionName The name of the child function.
   */
  createChildFunction(functionName: string): { childFunction: FunctionResource, functionName: string } {
    if (!this.currentFunction) {
      throw Error('Entering child function without registering a root function')
    }

    const childName = this.getUniqueChildName(functionName)

    // Update the current function - it now is the child function.
    const emptyFunction = {
      children: new Map(), isResource: true as const, commands: [], path: [...this.currentFunction.path, childName],
    }

    this.currentFunction.children.set(childName, emptyFunction)

    // Return its full minecraft name
    return {
      functionName: toMcFunctionName(emptyFunction.path),
      childFunction: emptyFunction,
    }
  }

  /**
   * Creates and enters a new child function of the current function.
   * @param functionName The name of the child function.
   */
  createEnterChildFunction(functionName: string): string {
    const { childFunction, functionName: realFunctionName } = this.createChildFunction(functionName)

    this.currentFunction = childFunction

    // Return its full minecraft name
    return realFunctionName
  }

  /**
   * Recursively exit the current function of the datapack.
   *
   * If we're in a child function of a root function (or a n-th child), it will exit them too.
   */
  private exitRootFunction(): void {
    if (!this.currentFunction) {
      throw Error('Exiting a not-existing function')
    }

    this.currentFunction = null
  }

  /**
   * Exit the current child function, and enter the parent function.
   */
  exitChildFunction(): void {
    if (!this.currentFunction) {
      throw Error('Exiting a not-existing function')
    }

    const parentPath = this.currentFunction.path.slice(0, -1)

    try {
      this.currentFunction = this.resources.getResource(parentPath, 'functions')
    } catch (e) {
      this.currentFunction = null
    }
  }

  registerNewObjective = (objective: ObjectiveClass) => {
    if (this.objectives.has(objective.name)) {
      throw new Error(`An objective named "${objective.name}" already exists.`)
    }
    this.objectives.set(objective.name, objective)
  }

  /**
   * Register a new command in the current function.
   * @param commandArgs The arguments of the command to add.
   */
  registerNewCommand = (commandArgs: CommandArgs): void => {
    if (!this.currentFunction || !this.currentFunction.isResource) {
      throw Error('Adding a command outside of a registered function')
    }

    this.currentFunction.commands.push(commandArgs)
  }

  /**
   * Register a new numeric constant.
   */
  registerNewConstant(amount: number) {
    this.constants.add(amount)
  }

  /**
   * Creates a Minecraft Function.
   *
   * @param name The name of the function.
   * @param callback A callback containing the commands you want in the Minecraft Function.
   */
  mcfunction = <T extends (...args: any[]) => void>(
    name: string, callback: T, options?: McFunctionOptions,
  ): McFunctionReturn<Parameters<T>> => {
    const realOptions: McFunctionOptions = { lazy: false, ...options }

    const alreadyInitializedParameters = new Set<string>()

    // We "reserve" the folder by creating an empty folder there
    const functionsFolder = this.getFunctionAndNamespace(name)
    const functionsFolderResource = this.resources.addResource('functions', {
      children: new Map(), isResource: false as const, path: functionsFolder,
    })

    /**
     * This function is used to call the callback.
     */
    const callCallback = (callbackArgs: Parameters<T>, registerFunctionCall?: (functionName: string) => void) => {
      // Keep the previous function
      const previousFunction = this.currentFunction

      /* We have 2 possibilities.
       * 1. For a no-parameter function, we directly write in the root function.
       * 2. For a function with parameters, we get a child
       */
      if (!this.currentFunction) {
        this.currentFunction = functionsFolderResource
      }

      let newFunction: FunctionResource

      if (callbackArgs.length === 0) {
        // We initialized with "null", now we set to empty commands
        newFunction = Object.assign(functionsFolderResource, { isResource: true as const, commands: [] })
      } else {
        // Parametrized function
        const result = this.createChildFunction('call')
        newFunction = result.childFunction
      }

      const newPath = newFunction?.path as ResourcePath
      console.log('Registering inside', toMcFunctionName(this.currentFunction.path))
      registerFunctionCall?.(toMcFunctionName(newPath))

      this.currentFunction = newFunction

      // Add the commands by calling the function
      callback(...callbackArgs)

      // Register the last command if needed
      this.commandsRoot.register(true)

      // Go back to the previous function
      this.currentFunction = previousFunction
    }

    if (!realOptions.lazy) {
      // If the mcfunction is not lazy, then we directly create it

      if (callback.length >= 1) {
        // However, if the callback requires arguments, but the function is not lazy, we can't create the function
        throw new Error(
          `Got a parametrized function "${name}" expecting at least ${callback.length} arguments, without being lazy.\n`
        + 'Since it is not lazy, Sandstone tried to create it without passing any arguments.\n'
        + 'This is not possible. Consider putting default values to the parameters, or setting the function as lazy.',
        )
      }

      // We know our callback has NO arguments. It's fine TypeScript, it really is!

      callCallback([] as unknown as Parameters<T>)

      alreadyInitializedParameters.add('[]')
    }

    const callMcFunction = (callbackArgs: Parameters<T>, schedule?: {delay: number | string, type: 'append' | 'replace'}) => {
      const jsonRepresentation = JSON.stringify(callbackArgs)

      if (!alreadyInitializedParameters.has(jsonRepresentation)) {
        // If it's the 1st time this mcfunction is called with these arguments, we create a new overload
        alreadyInitializedParameters.add(jsonRepresentation)

        callCallback(callbackArgs, (functionName) => {
          console.log('hh')
          if (schedule) {
            this.commandsRoot.arguments.push('schedule', 'function', functionName, schedule.delay, schedule.type)
          } else {
            this.commandsRoot.arguments.push('function', functionName)
          }

          this.commandsRoot.executable = true
          this.commandsRoot.register()
        })
      }
    }

    // When calling the result of mcfunction, it will be considered as the command /function functionName!
    const returnFunction = (...callbackArgs: Parameters<T>) => {
      callMcFunction(callbackArgs)
    }

    returnFunction.schedule = (delay: number | LiteralUnion<'1t' | '1s' | '1d'>, type: 'append' | 'replace', ...callbackArgs: Parameters<T>) => {
      callMcFunction(callbackArgs, { delay, type })
    }

    return returnFunction
  }

  /**
   * Saves the datapack to the file system.
   *
   * @param name The name of the Datapack
   * @param options The save options
   */
  save = (name: string, options: SaveOptions = {}): void => {
    this.createEnterRootFunction('__init__')

    if (this.constants.size > 0) {
      this.commandsRoot.scoreboard.objectives.add('sandstone_const', 'dummy', [{ text: 'Sandstone Constants' }])

      this.constants.forEach((constant) => {
        this.commandsRoot.scoreboard.players.set(constant, 'sandstone_const', constant)
      })
    }

    if (this.objectives.size > 0) {
      this.objectives.forEach((objective) => {
        this.commandsRoot.scoreboard.objectives.add(objective.name, objective.criterion, objective._displayRaw)
      })
    }

    this.exitRootFunction()

    saveDatapack(
      this.resources,
      name,
      options,
    )
  }
}
