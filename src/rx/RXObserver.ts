import { AnyRXObservable, RXObservable, RXPublisherUID } from 'flinker'
import {useLayoutEffect, useRef, useState} from 'react'

const __DEV__ = false
/*
*
*
* GLOBAL OBSERVE METHODS
*
*
* */

export function observe<RXElement extends AnyRXObservable | undefined>(rx: RXElement): RXElement {
  if (rx) {
    const jsxSubscriber = ObservableGlobalState.initializingJSXComponent
    if (jsxSubscriber !== JSXSubscriber.empty) {
      logInfo('observe(' + rx.constructor.name + '), subscriber uid =', jsxSubscriber.uid)
      jsxSubscriber.observe(rx)
    } else {
      logWarn('observe(' + rx.constructor.name + ') is failed: JSX Function Component has not "observer" wrapper!')
    }
  }

  return rx
}

export function observeFrom(rx: () => AnyRXObservable) {
  if (rx) {
    const jsxSubscriber = ObservableGlobalState.initializingJSXComponent
    if (jsxSubscriber !== JSXSubscriber.empty) {
      logInfo('observeFunc(' + rx.constructor.name + '), subscriber uid =', jsxSubscriber.uid)
      jsxSubscriber.observeFrom(rx)
    } else {
      logWarn('observeFunc(' + rx.constructor.name + ') is failed: JSX Function Component has not "observer" wrapper!')
    }
  }
}

export function observer<T>(component: (props: T) => React.JSX.Element): (props: T) => React.JSX.Element {
  return (props: T) => {
    const subscriberRef = useRef<JSXSubscriber>(JSXSubscriber.empty)
    const [, forceRender] = useState(ObservableGlobalState.renderCycle)

    if (subscriberRef.current === JSXSubscriber.empty) {
      subscriberRef.current = new JSXSubscriber((renderCycle) => {
        forceRender(renderCycle)
      })
    }

    if (__DEV__) {
      useLayoutEffect(() => {
        if (ObservableGlobalState.debug) logInfo('Registering of unmounting [' + subscriberRef.current.uid + ']')
        if (subscriberRef.current.isDisposed) {
          if (ObservableGlobalState.debug) logInfo('Disposed Subscriber [' + subscriberRef.current.uid + '] is resurrected')
          subscriberRef.current.resurrect()
        }
        return () => {
          if (ObservableGlobalState.debug) logInfo('Subscriber [' + subscriberRef.current.uid + '] is unmounted and disposed')
          subscriberRef.current.dispose()
        }
      }, [])
    } else {
      useLayoutEffect(() => () => { subscriberRef.current.dispose() }, [])
    }

    const parentGlobalComponent = ObservableGlobalState.initializingJSXComponent
    ObservableGlobalState.initializingJSXComponent = subscriberRef.current

    //initializing begin
    subscriberRef.current.renderCycle = ObservableGlobalState.renderCycle
    const renderedComponent = component(props)
    subscriberRef.current.initialized = true
    //initializing end

    ObservableGlobalState.initializingJSXComponent = parentGlobalComponent

    return renderedComponent
  }
}

/*
*
*
* JSXSubscriber
*
*
* */

//--------------------------------------
//  JSXSubscriber
//--------------------------------------
type JSXSubscriberUID = number
const suid = (() => { let value = 0; return (): number => { return value++ } })()

export class JSXSubscriber {
  static readonly empty = new JSXSubscriber(() => {})
  readonly uid: JSXSubscriberUID
  private readonly buildersSet = new Set<RXPublisherUID>()
  private readonly unsubscribeColl = Array<() => void>()
  renderCycle = -1
  initialized = false

  readonly forceRenderFunc: (renderCycle: number) => void

  constructor(forceRenderFunc: (renderCycle: number) => void) {
    this.uid = suid()
    this.forceRenderFunc = forceRenderFunc
  }

  private _isDisposed: boolean = false
  get isDisposed(): boolean {
    return this._isDisposed
  }

  observe<V, E>(b: RXObservable<V, E>) {
    if (b.isComplete || this.buildersSet.has(b.suid)) return
    this.buildersSet.add(b.suid)
    this.unsubscribeColl.push(
      b.pipe()
        .onReceive(() => {
          RenderQueue.self.add(this)
        })
        .subscribe()
    )
  }

  observeFrom(f: () => AnyRXObservable) {
    if (this.initialized) return
    this.unsubscribeColl.push(
      f().pipe()
        .skipFirst()
        .onReceive(() => {
          RenderQueue.self.add(this)
        })
        .subscribe()
    )
  }

  dispose() {
    this._isDisposed = true
    if (!__DEV__) this.unsubscribeColl.forEach(f => { f() })
  }

  resurrect() {
    this._isDisposed = false
  }

  render(renderCycle: number): boolean {
    if (this.isDisposed || this.renderCycle === renderCycle) {
      return false
    } else {
      this.renderCycle = renderCycle
      logInfo('----::forceRenderFunc')
      this.forceRenderFunc(this.renderCycle)
      return true
    }
  }
}

//--------------------------------------
//  GlobalState
//--------------------------------------

export class ObservableGlobalState {
  static renderCycle = 0
  static initializingJSXComponent: JSXSubscriber = JSXSubscriber.empty
  static debug = false
}

//--------------------------------------
//  RenderQueue
//--------------------------------------

export enum RenderQueueStatus {
  IDLE = 'IDLE',
  PENDING = 'PENDING',
  RUNNING = 'LOADING',
}

class RenderQueue {
  static readonly self = new RenderQueue()
  private readonly temp = Array<JSXSubscriber>()
  private readonly queue = new Set<JSXSubscriber>()
  private status = RenderQueueStatus.IDLE

  add(s: JSXSubscriber) {
    if (this.infiniteLoopDetected) return
    if (this.status === RenderQueueStatus.RUNNING) {
      this.temp.push(s)
    } else {
      this.queue.add(s)
      if (this.status === RenderQueueStatus.IDLE) {
        this.status = RenderQueueStatus.PENDING
        setTimeout(() => {
          this.render()
        }, 0)
      }
    }
  }

  private readonly INFINITE_LOOP_LIMIT = 20
  private infiniteLoopDetected = false
  private loopRenderings = 0

  private render() {
    logInfo('RenderQueue:render: begin, cycle:', ObservableGlobalState.renderCycle)
    this.status = RenderQueueStatus.RUNNING
    ObservableGlobalState.renderCycle++
    let renderedComponentsCount = 0

    Array.from(this.queue)
      .sort((s1, s2) => s1.uid - s2.uid)
      .forEach(subscriber => {
        subscriber.render(ObservableGlobalState.renderCycle) && renderedComponentsCount++
      })

    this.queue.clear()

    this.status = RenderQueueStatus.IDLE
    if (this.temp.length > 0) {
      this.loopRenderings++

      if (this.loopRenderings > 2) {
        logWarn('Sending value from publisher while jsx-component is rendering may cause an infinite loop. Loop renderings:', this.loopRenderings,
          '. Most active publishers: [', ...this.temp.map(ob => ob.constructor.name), ']')
      }

      if (this.loopRenderings < this.INFINITE_LOOP_LIMIT) {
        this.temp.forEach(publisherUID => {
          this.add(publisherUID)
        })
        this.temp.length = 0
      } else {
        this.infiniteLoopDetected = true
        logWarn('--Infinite Loop! The possible reason: An executed jsx-component X invoked new rendering of a jsx-component, ' +
          'that caused mutation in publisher, that trigger again force render of X')
      }
    } else {
      this.loopRenderings = 0
    }
    logInfo('RenderQueue:render: end, renderedComponentsCount:', renderedComponentsCount)
  }
}

//--------------------------------------
//  logging
//--------------------------------------

const logInfo = (...msg: any[]) => {
  if (ObservableGlobalState.debug) console.log(...msg)
}

const logWarn = (...msg: any[]) => {
  console.warn(...msg)
}
