## Intro
__Flinker-React__ (FR) — an observable pattern based library. __FR__ is written using [Flinker](https://github.com/Dittner/Flinker). __FR__ can be used as an app state managment, that focuses on the mutations of the observable objects: DomainEntities, ViewModels, Services, etc. The lib doesn't allow to subscribe to changes of object's properties, lists or primitive values. In addition, subscriptions are registered manually, that makes __FR__ more transparent and flexible than MobX.

## As an example, let's create a simple ToDo App

Our domain model has only a ToDo-Task:
```ts
import { observe } from 'flinker-react'
import { RXObservableEntity } from 'flinker'

class Task extends RXObservableEntity<Task> {
  private readonly _text: string
  get text(): string {
    return this._text
  }

  private _isDone: boolean
  get isDone(): boolean {
    return this._isDone
  }

  constructor(text: string) {
    super('TodoTask')
    this._text = text
    this._isDone = false
  }

  done() {
    this._isDone = true
    this.mutated()
  }
}
```

The ViewModel contains a list of tasks:
```ts
import { RXObservableValue } from 'flinker'

export class TodoListVM {
  readonly $tasks = new RXObservableValue<Task[]>([])

  addTask(text: string) {
    this.$tasks.value = this.$tasks.value.concat(new Task(text))
  }
}
```

The `TodoListView` must be rendered only after a new task is added. The `TaskView` must be rendered after a new task is added or the task's status is changed. For this we have to use `observer` and `observe` function-wrappers:

```ts
import { observe, observer } from 'flinker-react'

const todoListVM = new TodoListVM()

const TodoListView = observer(() => {
  const vm = observe(todoListVM)
  
  const addTask = () => {
    vm.addTask('Task ' + (vm.tasks.length + 1)) 
  }
  
  return <div>
    <p>     Todo App     </p>
    <p>------------------</p>
    {vm.tasks.map(task => {
      return <TaskView key={task.text}
                       task={task}/>
    })}
    <p>------------------</p>
    <button onClick={addTask()}>Add Task</button>
  </div>
})

interface TaskViewProps {
  task: Task
}

const TaskView = observer((props: TaskViewProps) => {
  const task = observe(props.task)
  return (
    <p onClick={() => { task.done() }}>
      {task.text + (task.isDone ? ': DONE' : ': IN PROGRESS')}
    </p>
  )
})
```

## Install
```cli
npm i flinker-react
```

## License
MIT