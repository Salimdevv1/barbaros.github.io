
(function(l, r) { if (l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (window.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(window.document);
var app = (function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    let src_url_equal_anchor;
    function src_url_equal(element_src, url) {
        if (!src_url_equal_anchor) {
            src_url_equal_anchor = document.createElement('a');
        }
        src_url_equal_anchor.href = url;
        return element_src === src_url_equal_anchor.href;
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function subscribe(store, ...callbacks) {
        if (store == null) {
            return noop;
        }
        const unsub = store.subscribe(...callbacks);
        return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        if (value == null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * Schedules a callback to run immediately after the component has been updated.
     *
     * The first time the callback runs will be after the initial `onMount`
     */
    function afterUpdate(fn) {
        get_current_component().$$.after_update.push(fn);
    }
    /**
     * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
     * Event dispatchers are functions that can take two arguments: `name` and `detail`.
     *
     * Component events created with `createEventDispatcher` create a
     * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
     * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
     * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
     * property and can contain any type of data.
     *
     * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
     */
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            // @ts-ignore
            callbacks.slice().forEach(fn => fn.call(this, event));
        }
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function tick() {
        schedule_update();
        return resolved_promise;
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }

    function get_spread_update(levels, updates) {
        const update = {};
        const to_null_out = {};
        const accounted_for = { $$scope: 1 };
        let i = levels.length;
        while (i--) {
            const o = levels[i];
            const n = updates[i];
            if (n) {
                for (const key in o) {
                    if (!(key in n))
                        to_null_out[key] = 1;
                }
                for (const key in n) {
                    if (!accounted_for[key]) {
                        update[key] = n[key];
                        accounted_for[key] = 1;
                    }
                }
                levels[i] = n;
            }
            else {
                for (const key in o) {
                    accounted_for[key] = 1;
                }
            }
        }
        for (const key in to_null_out) {
            if (!(key in update))
                update[key] = undefined;
        }
        return update;
    }
    function get_spread_object(spread_props) {
        return typeof spread_props === 'object' && spread_props !== null ? spread_props : {};
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.59.2' }, detail), { bubbles: true }));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation, has_stop_immediate_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        if (has_stop_immediate_propagation)
            modifiers.push('stopImmediatePropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    function construct_svelte_component_dev(component, props) {
        const error_message = 'this={...} of <svelte:component> should specify a Svelte component.';
        try {
            const instance = new component(props);
            if (!instance.$$ || !instance.$set || !instance.$on || !instance.$destroy) {
                throw new Error(error_message);
            }
            return instance;
        }
        catch (err) {
            const { message } = err;
            if (typeof message === 'string' && message.indexOf('is not a constructor') !== -1) {
                throw new Error(error_message);
            }
            else {
                throw err;
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /**
     * @typedef {Object} WrappedComponent Object returned by the `wrap` method
     * @property {SvelteComponent} component - Component to load (this is always asynchronous)
     * @property {RoutePrecondition[]} [conditions] - Route pre-conditions to validate
     * @property {Object} [props] - Optional dictionary of static props
     * @property {Object} [userData] - Optional user data dictionary
     * @property {bool} _sveltesparouter - Internal flag; always set to true
     */

    /**
     * @callback AsyncSvelteComponent
     * @returns {Promise<SvelteComponent>} Returns a Promise that resolves with a Svelte component
     */

    /**
     * @callback RoutePrecondition
     * @param {RouteDetail} detail - Route detail object
     * @returns {boolean|Promise<boolean>} If the callback returns a false-y value, it's interpreted as the precondition failed, so it aborts loading the component (and won't process other pre-condition callbacks)
     */

    /**
     * @typedef {Object} WrapOptions Options object for the call to `wrap`
     * @property {SvelteComponent} [component] - Svelte component to load (this is incompatible with `asyncComponent`)
     * @property {AsyncSvelteComponent} [asyncComponent] - Function that returns a Promise that fulfills with a Svelte component (e.g. `{asyncComponent: () => import('Foo.svelte')}`)
     * @property {SvelteComponent} [loadingComponent] - Svelte component to be displayed while the async route is loading (as a placeholder); when unset or false-y, no component is shown while component
     * @property {object} [loadingParams] - Optional dictionary passed to the `loadingComponent` component as params (for an exported prop called `params`)
     * @property {object} [userData] - Optional object that will be passed to events such as `routeLoading`, `routeLoaded`, `conditionsFailed`
     * @property {object} [props] - Optional key-value dictionary of static props that will be passed to the component. The props are expanded with {...props}, so the key in the dictionary becomes the name of the prop.
     * @property {RoutePrecondition[]|RoutePrecondition} [conditions] - Route pre-conditions to add, which will be executed in order
     */

    /**
     * Wraps a component to enable multiple capabilities:
     * 1. Using dynamically-imported component, with (e.g. `{asyncComponent: () => import('Foo.svelte')}`), which also allows bundlers to do code-splitting.
     * 2. Adding route pre-conditions (e.g. `{conditions: [...]}`)
     * 3. Adding static props that are passed to the component
     * 4. Adding custom userData, which is passed to route events (e.g. route loaded events) or to route pre-conditions (e.g. `{userData: {foo: 'bar}}`)
     * 
     * @param {WrapOptions} args - Arguments object
     * @returns {WrappedComponent} Wrapped component
     */
    function wrap(args) {
        if (!args) {
            throw Error('Parameter args is required')
        }

        // We need to have one and only one of component and asyncComponent
        // This does a "XNOR"
        if (!args.component == !args.asyncComponent) {
            throw Error('One and only one of component and asyncComponent is required')
        }

        // If the component is not async, wrap it into a function returning a Promise
        if (args.component) {
            args.asyncComponent = () => Promise.resolve(args.component);
        }

        // Parameter asyncComponent and each item of conditions must be functions
        if (typeof args.asyncComponent != 'function') {
            throw Error('Parameter asyncComponent must be a function')
        }
        if (args.conditions) {
            // Ensure it's an array
            if (!Array.isArray(args.conditions)) {
                args.conditions = [args.conditions];
            }
            for (let i = 0; i < args.conditions.length; i++) {
                if (!args.conditions[i] || typeof args.conditions[i] != 'function') {
                    throw Error('Invalid parameter conditions[' + i + ']')
                }
            }
        }

        // Check if we have a placeholder component
        if (args.loadingComponent) {
            args.asyncComponent.loading = args.loadingComponent;
            args.asyncComponent.loadingParams = args.loadingParams || undefined;
        }

        // Returns an object that contains all the functions to execute too
        // The _sveltesparouter flag is to confirm the object was created by this router
        const obj = {
            component: args.asyncComponent,
            userData: args.userData,
            conditions: (args.conditions && args.conditions.length) ? args.conditions : undefined,
            props: (args.props && Object.keys(args.props).length) ? args.props : {},
            _sveltesparouter: true
        };

        return obj
    }

    const subscriber_queue = [];
    /**
     * Creates a `Readable` store that allows reading by subscription.
     * @param value initial value
     * @param {StartStopNotifier} [start]
     */
    function readable(value, start) {
        return {
            subscribe: writable(value, start).subscribe
        };
    }
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=} start
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = new Set();
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (const subscriber of subscribers) {
                        subscriber[1]();
                        subscriber_queue.push(subscriber, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.add(subscriber);
            if (subscribers.size === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                subscribers.delete(subscriber);
                if (subscribers.size === 0 && stop) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }
    function derived(stores, fn, initial_value) {
        const single = !Array.isArray(stores);
        const stores_array = single
            ? [stores]
            : stores;
        const auto = fn.length < 2;
        return readable(initial_value, (set) => {
            let started = false;
            const values = [];
            let pending = 0;
            let cleanup = noop;
            const sync = () => {
                if (pending) {
                    return;
                }
                cleanup();
                const result = fn(single ? values[0] : values, set);
                if (auto) {
                    set(result);
                }
                else {
                    cleanup = is_function(result) ? result : noop;
                }
            };
            const unsubscribers = stores_array.map((store, i) => subscribe(store, (value) => {
                values[i] = value;
                pending &= ~(1 << i);
                if (started) {
                    sync();
                }
            }, () => {
                pending |= (1 << i);
            }));
            started = true;
            sync();
            return function stop() {
                run_all(unsubscribers);
                cleanup();
                // We need to set this to false because callbacks can still happen despite having unsubscribed:
                // Callbacks might already be placed in the queue which doesn't know it should no longer
                // invoke this derived store.
                started = false;
            };
        });
    }

    function regexparam (str, loose) {
    	if (str instanceof RegExp) return { keys:false, pattern:str };
    	var c, o, tmp, ext, keys=[], pattern='', arr = str.split('/');
    	arr[0] || arr.shift();

    	while (tmp = arr.shift()) {
    		c = tmp[0];
    		if (c === '*') {
    			keys.push('wild');
    			pattern += '/(.*)';
    		} else if (c === ':') {
    			o = tmp.indexOf('?', 1);
    			ext = tmp.indexOf('.', 1);
    			keys.push( tmp.substring(1, !!~o ? o : !!~ext ? ext : tmp.length) );
    			pattern += !!~o && !~ext ? '(?:/([^/]+?))?' : '/([^/]+?)';
    			if (!!~ext) pattern += (!!~o ? '?' : '') + '\\' + tmp.substring(ext);
    		} else {
    			pattern += '/' + tmp;
    		}
    	}

    	return {
    		keys: keys,
    		pattern: new RegExp('^' + pattern + (loose ? '(?=$|\/)' : '\/?$'), 'i')
    	};
    }

    /* node_modules\svelte-spa-router\Router.svelte generated by Svelte v3.59.2 */

    const { Error: Error_1, Object: Object_1, console: console_1 } = globals;

    // (209:0) {:else}
    function create_else_block(ctx) {
    	let switch_instance;
    	let switch_instance_anchor;
    	let current;
    	const switch_instance_spread_levels = [/*props*/ ctx[2]];
    	var switch_value = /*component*/ ctx[0];

    	function switch_props(ctx) {
    		let switch_instance_props = {};

    		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
    			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
    		}

    		return {
    			props: switch_instance_props,
    			$$inline: true
    		};
    	}

    	if (switch_value) {
    		switch_instance = construct_svelte_component_dev(switch_value, switch_props());
    		switch_instance.$on("routeEvent", /*routeEvent_handler_1*/ ctx[7]);
    	}

    	const block = {
    		c: function create() {
    			if (switch_instance) create_component(switch_instance.$$.fragment);
    			switch_instance_anchor = empty();
    		},
    		m: function mount(target, anchor) {
    			if (switch_instance) mount_component(switch_instance, target, anchor);
    			insert_dev(target, switch_instance_anchor, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const switch_instance_changes = (dirty & /*props*/ 4)
    			? get_spread_update(switch_instance_spread_levels, [get_spread_object(/*props*/ ctx[2])])
    			: {};

    			if (dirty & /*component*/ 1 && switch_value !== (switch_value = /*component*/ ctx[0])) {
    				if (switch_instance) {
    					group_outros();
    					const old_component = switch_instance;

    					transition_out(old_component.$$.fragment, 1, 0, () => {
    						destroy_component(old_component, 1);
    					});

    					check_outros();
    				}

    				if (switch_value) {
    					switch_instance = construct_svelte_component_dev(switch_value, switch_props());
    					switch_instance.$on("routeEvent", /*routeEvent_handler_1*/ ctx[7]);
    					create_component(switch_instance.$$.fragment);
    					transition_in(switch_instance.$$.fragment, 1);
    					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
    				} else {
    					switch_instance = null;
    				}
    			} else if (switch_value) {
    				switch_instance.$set(switch_instance_changes);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(switch_instance_anchor);
    			if (switch_instance) destroy_component(switch_instance, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(209:0) {:else}",
    		ctx
    	});

    	return block;
    }

    // (202:0) {#if componentParams}
    function create_if_block(ctx) {
    	let switch_instance;
    	let switch_instance_anchor;
    	let current;
    	const switch_instance_spread_levels = [{ params: /*componentParams*/ ctx[1] }, /*props*/ ctx[2]];
    	var switch_value = /*component*/ ctx[0];

    	function switch_props(ctx) {
    		let switch_instance_props = {};

    		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
    			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
    		}

    		return {
    			props: switch_instance_props,
    			$$inline: true
    		};
    	}

    	if (switch_value) {
    		switch_instance = construct_svelte_component_dev(switch_value, switch_props());
    		switch_instance.$on("routeEvent", /*routeEvent_handler*/ ctx[6]);
    	}

    	const block = {
    		c: function create() {
    			if (switch_instance) create_component(switch_instance.$$.fragment);
    			switch_instance_anchor = empty();
    		},
    		m: function mount(target, anchor) {
    			if (switch_instance) mount_component(switch_instance, target, anchor);
    			insert_dev(target, switch_instance_anchor, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const switch_instance_changes = (dirty & /*componentParams, props*/ 6)
    			? get_spread_update(switch_instance_spread_levels, [
    					dirty & /*componentParams*/ 2 && { params: /*componentParams*/ ctx[1] },
    					dirty & /*props*/ 4 && get_spread_object(/*props*/ ctx[2])
    				])
    			: {};

    			if (dirty & /*component*/ 1 && switch_value !== (switch_value = /*component*/ ctx[0])) {
    				if (switch_instance) {
    					group_outros();
    					const old_component = switch_instance;

    					transition_out(old_component.$$.fragment, 1, 0, () => {
    						destroy_component(old_component, 1);
    					});

    					check_outros();
    				}

    				if (switch_value) {
    					switch_instance = construct_svelte_component_dev(switch_value, switch_props());
    					switch_instance.$on("routeEvent", /*routeEvent_handler*/ ctx[6]);
    					create_component(switch_instance.$$.fragment);
    					transition_in(switch_instance.$$.fragment, 1);
    					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
    				} else {
    					switch_instance = null;
    				}
    			} else if (switch_value) {
    				switch_instance.$set(switch_instance_changes);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(switch_instance_anchor);
    			if (switch_instance) destroy_component(switch_instance, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(202:0) {#if componentParams}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block, create_else_block];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*componentParams*/ ctx[1]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	const block = {
    		c: function create() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l: function claim(nodes) {
    			throw new Error_1("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function wrap$1(component, userData, ...conditions) {
    	// Use the new wrap method and show a deprecation warning
    	// eslint-disable-next-line no-console
    	console.warn('Method `wrap` from `svelte-spa-router` is deprecated and will be removed in a future version. Please use `svelte-spa-router/wrap` instead. See http://bit.ly/svelte-spa-router-upgrading');

    	return wrap({ component, userData, conditions });
    }

    /**
     * @typedef {Object} Location
     * @property {string} location - Location (page/view), for example `/book`
     * @property {string} [querystring] - Querystring from the hash, as a string not parsed
     */
    /**
     * Returns the current location from the hash.
     *
     * @returns {Location} Location object
     * @private
     */
    function getLocation() {
    	const hashPosition = window.location.href.indexOf('#/');

    	let location = hashPosition > -1
    	? window.location.href.substr(hashPosition + 1)
    	: '/';

    	// Check if there's a querystring
    	const qsPosition = location.indexOf('?');

    	let querystring = '';

    	if (qsPosition > -1) {
    		querystring = location.substr(qsPosition + 1);
    		location = location.substr(0, qsPosition);
    	}

    	return { location, querystring };
    }

    const loc = readable(null, // eslint-disable-next-line prefer-arrow-callback
    function start(set) {
    	set(getLocation());

    	const update = () => {
    		set(getLocation());
    	};

    	window.addEventListener('hashchange', update, false);

    	return function stop() {
    		window.removeEventListener('hashchange', update, false);
    	};
    });

    const location = derived(loc, $loc => $loc.location);
    const querystring = derived(loc, $loc => $loc.querystring);

    async function push(location) {
    	if (!location || location.length < 1 || location.charAt(0) != '/' && location.indexOf('#/') !== 0) {
    		throw Error('Invalid parameter location');
    	}

    	// Execute this code when the current call stack is complete
    	await tick();

    	// Note: this will include scroll state in history even when restoreScrollState is false
    	history.replaceState(
    		{
    			scrollX: window.scrollX,
    			scrollY: window.scrollY
    		},
    		undefined,
    		undefined
    	);

    	window.location.hash = (location.charAt(0) == '#' ? '' : '#') + location;
    }

    async function pop() {
    	// Execute this code when the current call stack is complete
    	await tick();

    	window.history.back();
    }

    async function replace(location) {
    	if (!location || location.length < 1 || location.charAt(0) != '/' && location.indexOf('#/') !== 0) {
    		throw Error('Invalid parameter location');
    	}

    	// Execute this code when the current call stack is complete
    	await tick();

    	const dest = (location.charAt(0) == '#' ? '' : '#') + location;

    	try {
    		window.history.replaceState(undefined, undefined, dest);
    	} catch(e) {
    		// eslint-disable-next-line no-console
    		console.warn('Caught exception while replacing the current page. If you\'re running this in the Svelte REPL, please note that the `replace` method might not work in this environment.');
    	}

    	// The method above doesn't trigger the hashchange event, so let's do that manually
    	window.dispatchEvent(new Event('hashchange'));
    }

    function link(node, hrefVar) {
    	// Only apply to <a> tags
    	if (!node || !node.tagName || node.tagName.toLowerCase() != 'a') {
    		throw Error('Action "link" can only be used with <a> tags');
    	}

    	updateLink(node, hrefVar || node.getAttribute('href'));

    	return {
    		update(updated) {
    			updateLink(node, updated);
    		}
    	};
    }

    // Internal function used by the link function
    function updateLink(node, href) {
    	// Destination must start with '/'
    	if (!href || href.length < 1 || href.charAt(0) != '/') {
    		throw Error('Invalid value for "href" attribute: ' + href);
    	}

    	// Add # to the href attribute
    	node.setAttribute('href', '#' + href);

    	node.addEventListener('click', scrollstateHistoryHandler);
    }

    /**
     * The handler attached to an anchor tag responsible for updating the
     * current history state with the current scroll state
     *
     * @param {HTMLElementEventMap} event - an onclick event attached to an anchor tag
     */
    function scrollstateHistoryHandler(event) {
    	// Prevent default anchor onclick behaviour
    	event.preventDefault();

    	const href = event.currentTarget.getAttribute('href');

    	// Setting the url (3rd arg) to href will break clicking for reasons, so don't try to do that
    	history.replaceState(
    		{
    			scrollX: window.scrollX,
    			scrollY: window.scrollY
    		},
    		undefined,
    		undefined
    	);

    	// This will force an update as desired, but this time our scroll state will be attached
    	window.location.hash = href;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Router', slots, []);
    	let { routes = {} } = $$props;
    	let { prefix = '' } = $$props;
    	let { restoreScrollState = false } = $$props;

    	/**
     * Container for a route: path, component
     */
    	class RouteItem {
    		/**
     * Initializes the object and creates a regular expression from the path, using regexparam.
     *
     * @param {string} path - Path to the route (must start with '/' or '*')
     * @param {SvelteComponent|WrappedComponent} component - Svelte component for the route, optionally wrapped
     */
    		constructor(path, component) {
    			if (!component || typeof component != 'function' && (typeof component != 'object' || component._sveltesparouter !== true)) {
    				throw Error('Invalid component object');
    			}

    			// Path must be a regular or expression, or a string starting with '/' or '*'
    			if (!path || typeof path == 'string' && (path.length < 1 || path.charAt(0) != '/' && path.charAt(0) != '*') || typeof path == 'object' && !(path instanceof RegExp)) {
    				throw Error('Invalid value for "path" argument');
    			}

    			const { pattern, keys } = regexparam(path);
    			this.path = path;

    			// Check if the component is wrapped and we have conditions
    			if (typeof component == 'object' && component._sveltesparouter === true) {
    				this.component = component.component;
    				this.conditions = component.conditions || [];
    				this.userData = component.userData;
    				this.props = component.props || {};
    			} else {
    				// Convert the component to a function that returns a Promise, to normalize it
    				this.component = () => Promise.resolve(component);

    				this.conditions = [];
    				this.props = {};
    			}

    			this._pattern = pattern;
    			this._keys = keys;
    		}

    		/**
     * Checks if `path` matches the current route.
     * If there's a match, will return the list of parameters from the URL (if any).
     * In case of no match, the method will return `null`.
     *
     * @param {string} path - Path to test
     * @returns {null|Object.<string, string>} List of paramters from the URL if there's a match, or `null` otherwise.
     */
    		match(path) {
    			// If there's a prefix, remove it before we run the matching
    			if (prefix) {
    				if (typeof prefix == 'string' && path.startsWith(prefix)) {
    					path = path.substr(prefix.length) || '/';
    				} else if (prefix instanceof RegExp) {
    					const match = path.match(prefix);

    					if (match && match[0]) {
    						path = path.substr(match[0].length) || '/';
    					}
    				}
    			}

    			// Check if the pattern matches
    			const matches = this._pattern.exec(path);

    			if (matches === null) {
    				return null;
    			}

    			// If the input was a regular expression, this._keys would be false, so return matches as is
    			if (this._keys === false) {
    				return matches;
    			}

    			const out = {};
    			let i = 0;

    			while (i < this._keys.length) {
    				// In the match parameters, URL-decode all values
    				try {
    					out[this._keys[i]] = decodeURIComponent(matches[i + 1] || '') || null;
    				} catch(e) {
    					out[this._keys[i]] = null;
    				}

    				i++;
    			}

    			return out;
    		}

    		/**
     * Dictionary with route details passed to the pre-conditions functions, as well as the `routeLoading`, `routeLoaded` and `conditionsFailed` events
     * @typedef {Object} RouteDetail
     * @property {string|RegExp} route - Route matched as defined in the route definition (could be a string or a reguar expression object)
     * @property {string} location - Location path
     * @property {string} querystring - Querystring from the hash
     * @property {object} [userData] - Custom data passed by the user
     * @property {SvelteComponent} [component] - Svelte component (only in `routeLoaded` events)
     * @property {string} [name] - Name of the Svelte component (only in `routeLoaded` events)
     */
    		/**
     * Executes all conditions (if any) to control whether the route can be shown. Conditions are executed in the order they are defined, and if a condition fails, the following ones aren't executed.
     * 
     * @param {RouteDetail} detail - Route detail
     * @returns {bool} Returns true if all the conditions succeeded
     */
    		async checkConditions(detail) {
    			for (let i = 0; i < this.conditions.length; i++) {
    				if (!await this.conditions[i](detail)) {
    					return false;
    				}
    			}

    			return true;
    		}
    	}

    	// Set up all routes
    	const routesList = [];

    	if (routes instanceof Map) {
    		// If it's a map, iterate on it right away
    		routes.forEach((route, path) => {
    			routesList.push(new RouteItem(path, route));
    		});
    	} else {
    		// We have an object, so iterate on its own properties
    		Object.keys(routes).forEach(path => {
    			routesList.push(new RouteItem(path, routes[path]));
    		});
    	}

    	// Props for the component to render
    	let component = null;

    	let componentParams = null;
    	let props = {};

    	// Event dispatcher from Svelte
    	const dispatch = createEventDispatcher();

    	// Just like dispatch, but executes on the next iteration of the event loop
    	async function dispatchNextTick(name, detail) {
    		// Execute this code when the current call stack is complete
    		await tick();

    		dispatch(name, detail);
    	}

    	// If this is set, then that means we have popped into this var the state of our last scroll position
    	let previousScrollState = null;

    	if (restoreScrollState) {
    		window.addEventListener('popstate', event => {
    			// If this event was from our history.replaceState, event.state will contain
    			// our scroll history. Otherwise, event.state will be null (like on forward
    			// navigation)
    			if (event.state && event.state.scrollY) {
    				previousScrollState = event.state;
    			} else {
    				previousScrollState = null;
    			}
    		});

    		afterUpdate(() => {
    			// If this exists, then this is a back navigation: restore the scroll position
    			if (previousScrollState) {
    				window.scrollTo(previousScrollState.scrollX, previousScrollState.scrollY);
    			} else {
    				// Otherwise this is a forward navigation: scroll to top
    				window.scrollTo(0, 0);
    			}
    		});
    	}

    	// Always have the latest value of loc
    	let lastLoc = null;

    	// Current object of the component loaded
    	let componentObj = null;

    	// Handle hash change events
    	// Listen to changes in the $loc store and update the page
    	// Do not use the $: syntax because it gets triggered by too many things
    	loc.subscribe(async newLoc => {
    		lastLoc = newLoc;

    		// Find a route matching the location
    		let i = 0;

    		while (i < routesList.length) {
    			const match = routesList[i].match(newLoc.location);

    			if (!match) {
    				i++;
    				continue;
    			}

    			const detail = {
    				route: routesList[i].path,
    				location: newLoc.location,
    				querystring: newLoc.querystring,
    				userData: routesList[i].userData
    			};

    			// Check if the route can be loaded - if all conditions succeed
    			if (!await routesList[i].checkConditions(detail)) {
    				// Don't display anything
    				$$invalidate(0, component = null);

    				componentObj = null;

    				// Trigger an event to notify the user, then exit
    				dispatchNextTick('conditionsFailed', detail);

    				return;
    			}

    			// Trigger an event to alert that we're loading the route
    			// We need to clone the object on every event invocation so we don't risk the object to be modified in the next tick
    			dispatchNextTick('routeLoading', Object.assign({}, detail));

    			// If there's a component to show while we're loading the route, display it
    			const obj = routesList[i].component;

    			// Do not replace the component if we're loading the same one as before, to avoid the route being unmounted and re-mounted
    			if (componentObj != obj) {
    				if (obj.loading) {
    					$$invalidate(0, component = obj.loading);
    					componentObj = obj;
    					$$invalidate(1, componentParams = obj.loadingParams);
    					$$invalidate(2, props = {});

    					// Trigger the routeLoaded event for the loading component
    					// Create a copy of detail so we don't modify the object for the dynamic route (and the dynamic route doesn't modify our object too)
    					dispatchNextTick('routeLoaded', Object.assign({}, detail, { component, name: component.name }));
    				} else {
    					$$invalidate(0, component = null);
    					componentObj = null;
    				}

    				// Invoke the Promise
    				const loaded = await obj();

    				// Now that we're here, after the promise resolved, check if we still want this component, as the user might have navigated to another page in the meanwhile
    				if (newLoc != lastLoc) {
    					// Don't update the component, just exit
    					return;
    				}

    				// If there is a "default" property, which is used by async routes, then pick that
    				$$invalidate(0, component = loaded && loaded.default || loaded);

    				componentObj = obj;
    			}

    			// Set componentParams only if we have a match, to avoid a warning similar to `<Component> was created with unknown prop 'params'`
    			// Of course, this assumes that developers always add a "params" prop when they are expecting parameters
    			if (match && typeof match == 'object' && Object.keys(match).length) {
    				$$invalidate(1, componentParams = match);
    			} else {
    				$$invalidate(1, componentParams = null);
    			}

    			// Set static props, if any
    			$$invalidate(2, props = routesList[i].props);

    			// Dispatch the routeLoaded event then exit
    			// We need to clone the object on every event invocation so we don't risk the object to be modified in the next tick
    			dispatchNextTick('routeLoaded', Object.assign({}, detail, { component, name: component.name }));

    			return;
    		}

    		// If we're still here, there was no match, so show the empty component
    		$$invalidate(0, component = null);

    		componentObj = null;
    	});

    	const writable_props = ['routes', 'prefix', 'restoreScrollState'];

    	Object_1.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1.warn(`<Router> was created with unknown prop '${key}'`);
    	});

    	function routeEvent_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function routeEvent_handler_1(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('routes' in $$props) $$invalidate(3, routes = $$props.routes);
    		if ('prefix' in $$props) $$invalidate(4, prefix = $$props.prefix);
    		if ('restoreScrollState' in $$props) $$invalidate(5, restoreScrollState = $$props.restoreScrollState);
    	};

    	$$self.$capture_state = () => ({
    		readable,
    		derived,
    		tick,
    		_wrap: wrap,
    		wrap: wrap$1,
    		getLocation,
    		loc,
    		location,
    		querystring,
    		push,
    		pop,
    		replace,
    		link,
    		updateLink,
    		scrollstateHistoryHandler,
    		createEventDispatcher,
    		afterUpdate,
    		regexparam,
    		routes,
    		prefix,
    		restoreScrollState,
    		RouteItem,
    		routesList,
    		component,
    		componentParams,
    		props,
    		dispatch,
    		dispatchNextTick,
    		previousScrollState,
    		lastLoc,
    		componentObj
    	});

    	$$self.$inject_state = $$props => {
    		if ('routes' in $$props) $$invalidate(3, routes = $$props.routes);
    		if ('prefix' in $$props) $$invalidate(4, prefix = $$props.prefix);
    		if ('restoreScrollState' in $$props) $$invalidate(5, restoreScrollState = $$props.restoreScrollState);
    		if ('component' in $$props) $$invalidate(0, component = $$props.component);
    		if ('componentParams' in $$props) $$invalidate(1, componentParams = $$props.componentParams);
    		if ('props' in $$props) $$invalidate(2, props = $$props.props);
    		if ('previousScrollState' in $$props) previousScrollState = $$props.previousScrollState;
    		if ('lastLoc' in $$props) lastLoc = $$props.lastLoc;
    		if ('componentObj' in $$props) componentObj = $$props.componentObj;
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*restoreScrollState*/ 32) {
    			// Update history.scrollRestoration depending on restoreScrollState
    			 history.scrollRestoration = restoreScrollState ? 'manual' : 'auto';
    		}
    	};

    	return [
    		component,
    		componentParams,
    		props,
    		routes,
    		prefix,
    		restoreScrollState,
    		routeEvent_handler,
    		routeEvent_handler_1
    	];
    }

    class Router extends SvelteComponentDev {
    	constructor(options) {
    		super(options);

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			routes: 3,
    			prefix: 4,
    			restoreScrollState: 5
    		});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Router",
    			options,
    			id: create_fragment.name
    		});
    	}

    	get routes() {
    		throw new Error_1("<Router>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set routes(value) {
    		throw new Error_1("<Router>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get prefix() {
    		throw new Error_1("<Router>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set prefix(value) {
    		throw new Error_1("<Router>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get restoreScrollState() {
    		throw new Error_1("<Router>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set restoreScrollState(value) {
    		throw new Error_1("<Router>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src\routes\Home.svelte generated by Svelte v3.59.2 */

    const file = "src\\routes\\Home.svelte";

    function create_fragment$1(ctx) {
    	let main;
    	let div9;
    	let nav;
    	let div2;
    	let a0;
    	let img0;
    	let img0_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span0;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul0;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let li4;
    	let a5;
    	let t15;
    	let section0;
    	let div6;
    	let div4;
    	let h20;
    	let t16;
    	let div3;
    	let span1;
    	let t18;
    	let t19;
    	let img1;
    	let img1_src_value;
    	let t20;
    	let div5;
    	let p0;
    	let svg1;
    	let path1;
    	let t21;
    	let span2;
    	let t23;
    	let p1;
    	let span3;
    	let t25;
    	let t26;
    	let div8;
    	let img2;
    	let img2_src_value;
    	let t27;
    	let img3;
    	let img3_src_value;
    	let t28;
    	let div7;
    	let svg2;
    	let path2;
    	let t29;
    	let section1;
    	let div15;
    	let div13;
    	let p2;
    	let t30;
    	let span4;
    	let t32;
    	let div12;
    	let iframe;
    	let iframe_src_value;
    	let div11;
    	let div10;
    	let t33;
    	let a6;
    	let t35;
    	let script;
    	let script_src_value;
    	let style;
    	let br;
    	let t37;
    	let div14;
    	let img4;
    	let img4_src_value;
    	let t38;
    	let div16;
    	let p3;
    	let t40;
    	let p4;
    	let span5;
    	let t42;
    	let t43;
    	let p5;
    	let t45;
    	let section2;
    	let div17;
    	let img5;
    	let img5_src_value;
    	let t46;
    	let img6;
    	let img6_src_value;
    	let t47;
    	let a7;
    	let img7;
    	let img7_src_value;
    	let t48;
    	let section3;
    	let div24;
    	let p6;
    	let t50;
    	let div20;
    	let a8;
    	let div18;
    	let img8;
    	let img8_src_value;
    	let t51;
    	let p7;
    	let t53;
    	let p8;
    	let t55;
    	let a9;
    	let div19;
    	let img9;
    	let img9_src_value;
    	let t56;
    	let p9;
    	let t58;
    	let p10;
    	let t60;
    	let div23;
    	let a10;
    	let div21;
    	let img10;
    	let img10_src_value;
    	let t61;
    	let p11;
    	let t63;
    	let p12;
    	let t65;
    	let a11;
    	let div22;
    	let img11;
    	let img11_src_value;
    	let t66;
    	let p13;
    	let t68;
    	let p14;
    	let t70;
    	let p15;
    	let t72;
    	let p16;
    	let t74;
    	let section4;
    	let div40;
    	let a12;
    	let t75;
    	let p17;
    	let t77;
    	let div27;
    	let a13;
    	let div25;
    	let img12;
    	let img12_src_value;
    	let t78;
    	let p18;
    	let t80;
    	let p19;
    	let t81;
    	let span6;
    	let t83;
    	let t84;
    	let a14;
    	let div26;
    	let img13;
    	let img13_src_value;
    	let t85;
    	let p20;
    	let t87;
    	let p21;
    	let t88;
    	let span7;
    	let t90;
    	let t91;
    	let div30;
    	let a15;
    	let div28;
    	let img14;
    	let img14_src_value;
    	let t92;
    	let p22;
    	let t94;
    	let p23;
    	let t95;
    	let span8;
    	let t97;
    	let t98;
    	let a16;
    	let div29;
    	let img15;
    	let img15_src_value;
    	let t99;
    	let p24;
    	let t101;
    	let p25;
    	let t102;
    	let span9;
    	let t104;
    	let t105;
    	let div33;
    	let a17;
    	let div31;
    	let img16;
    	let img16_src_value;
    	let t106;
    	let p26;
    	let t108;
    	let p27;
    	let t109;
    	let span10;
    	let t111;
    	let t112;
    	let a18;
    	let div32;
    	let img17;
    	let img17_src_value;
    	let t113;
    	let p28;
    	let t115;
    	let p29;
    	let t116;
    	let span11;
    	let t118;
    	let t119;
    	let div36;
    	let a19;
    	let div34;
    	let img18;
    	let img18_src_value;
    	let t120;
    	let p30;
    	let t122;
    	let p31;
    	let t123;
    	let span12;
    	let t125;
    	let t126;
    	let a20;
    	let div35;
    	let img19;
    	let img19_src_value;
    	let t127;
    	let p32;
    	let t129;
    	let p33;
    	let t130;
    	let span13;
    	let t132;
    	let t133;
    	let div39;
    	let a21;
    	let div37;
    	let img20;
    	let img20_src_value;
    	let t134;
    	let p34;
    	let t136;
    	let p35;
    	let t137;
    	let span14;
    	let t139;
    	let t140;
    	let a22;
    	let div38;
    	let img21;
    	let img21_src_value;
    	let t141;
    	let p36;
    	let t143;
    	let p37;
    	let t144;
    	let span15;
    	let t146;
    	let t147;
    	let p38;
    	let t149;
    	let p39;
    	let t151;
    	let section5;
    	let p40;
    	let t152;
    	let span16;
    	let t154;
    	let t155;
    	let div44;
    	let div41;
    	let a23;
    	let img22;
    	let img22_src_value;
    	let t156;
    	let p41;
    	let t158;
    	let div42;
    	let a24;
    	let img23;
    	let img23_src_value;
    	let t159;
    	let p42;
    	let t161;
    	let div43;
    	let a25;
    	let img24;
    	let img24_src_value;
    	let t162;
    	let p43;
    	let t164;
    	let section6;
    	let img25;
    	let img25_src_value;
    	let t165;
    	let p44;
    	let t166;
    	let span17;
    	let t168;
    	let t169;
    	let p45;
    	let t171;
    	let center;
    	let div65;
    	let div64;
    	let div45;
    	let img26;
    	let img26_src_value;
    	let t172;
    	let div46;
    	let img27;
    	let img27_src_value;
    	let t173;
    	let div47;
    	let img28;
    	let img28_src_value;
    	let t174;
    	let div48;
    	let img29;
    	let img29_src_value;
    	let t175;
    	let div49;
    	let img30;
    	let img30_src_value;
    	let t176;
    	let div50;
    	let img31;
    	let img31_src_value;
    	let t177;
    	let div51;
    	let img32;
    	let img32_src_value;
    	let t178;
    	let div52;
    	let img33;
    	let img33_src_value;
    	let t179;
    	let div53;
    	let img34;
    	let img34_src_value;
    	let t180;
    	let div54;
    	let img35;
    	let img35_src_value;
    	let t181;
    	let div55;
    	let img36;
    	let img36_src_value;
    	let t182;
    	let div56;
    	let img37;
    	let img37_src_value;
    	let t183;
    	let div57;
    	let img38;
    	let img38_src_value;
    	let t184;
    	let div58;
    	let img39;
    	let img39_src_value;
    	let t185;
    	let div59;
    	let img40;
    	let img40_src_value;
    	let t186;
    	let div60;
    	let img41;
    	let img41_src_value;
    	let t187;
    	let div61;
    	let img42;
    	let img42_src_value;
    	let t188;
    	let div62;
    	let img43;
    	let img43_src_value;
    	let t189;
    	let div63;
    	let img44;
    	let img44_src_value;
    	let t190;
    	let button2;
    	let span19;
    	let svg3;
    	let path3;
    	let t191;
    	let span18;
    	let t193;
    	let button3;
    	let span21;
    	let svg4;
    	let path4;
    	let t194;
    	let span20;
    	let t196;
    	let section7;
    	let footer;
    	let div72;
    	let div70;
    	let div66;
    	let a26;
    	let img45;
    	let img45_src_value;
    	let t197;
    	let div69;
    	let div67;
    	let h21;
    	let t199;
    	let ul1;
    	let li5;
    	let a27;
    	let t201;
    	let li6;
    	let a28;
    	let t203;
    	let div68;
    	let h22;
    	let t205;
    	let ul2;
    	let li7;
    	let a29;
    	let t207;
    	let li8;
    	let a30;
    	let t209;
    	let hr;
    	let t210;
    	let div71;
    	let span22;
    	let a31;
    	let t212;
    	let a32;
    	let t214;
    	let a33;
    	let t216;
    	let t217;
    	let section8;
    	let div73;
    	let button4;
    	let svg5;
    	let path5;
    	let path6;
    	let t218;
    	let p46;
    	let t220;
    	let input;
    	let t221;
    	let p47;
    	let t223;
    	let a34;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			main = element("main");
    			div9 = element("div");
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img0 = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span0 = element("span");
    			span0.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul0 = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Server Rules";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "How to join";
    			t13 = space();
    			li4 = element("li");
    			a5 = element("a");
    			a5.textContent = "Discord";
    			t15 = space();
    			section0 = element("section");
    			div6 = element("div");
    			div4 = element("div");
    			h20 = element("h2");
    			t16 = text("Join The Best Tunisian");
    			div3 = element("div");
    			span1 = element("span");
    			span1.textContent = "COMMUNITY";
    			t18 = text(" in FiveM!");
    			t19 = space();
    			img1 = element("img");
    			t20 = space();
    			div5 = element("div");
    			p0 = element("p");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			t21 = space();
    			span2 = element("span");
    			span2.textContent = "0";
    			t23 = space();
    			p1 = element("p");
    			span3 = element("span");
    			span3.textContent = "PLAYERS";
    			t25 = text(" ONLINE");
    			t26 = space();
    			div8 = element("div");
    			img2 = element("img");
    			t27 = space();
    			img3 = element("img");
    			t28 = space();
    			div7 = element("div");
    			svg2 = svg_element("svg");
    			path2 = svg_element("path");
    			t29 = space();
    			section1 = element("section");
    			div15 = element("div");
    			div13 = element("div");
    			p2 = element("p");
    			t30 = text("SEASON ");
    			span4 = element("span");
    			span4.textContent = "7";
    			t32 = space();
    			div12 = element("div");
    			iframe = element("iframe");
    			div11 = element("div");
    			div10 = element("div");
    			t33 = text("Generated by ");
    			a6 = element("a");
    			a6.textContent = "Embed Youtube Video";
    			t35 = text(" online");
    			script = element("script");
    			style = element("style");
    			style.textContent = ".newst{position:relative;text-align:right;height:420px;width:520px;} #gmap_canvas img{max-width:none!important;background:none!important}";
    			br = element("br");
    			t37 = space();
    			div14 = element("div");
    			img4 = element("img");
    			t38 = space();
    			div16 = element("div");
    			p3 = element("p");
    			p3.textContent = "TUTORIAL";
    			t40 = space();
    			p4 = element("p");
    			span5 = element("span");
    			span5.textContent = "HOW";
    			t42 = text(" TO START PLAYING?");
    			t43 = space();
    			p5 = element("p");
    			p5.textContent = "ONLY 2 STEPTS";
    			t45 = space();
    			section2 = element("section");
    			div17 = element("div");
    			img5 = element("img");
    			t46 = space();
    			img6 = element("img");
    			t47 = space();
    			a7 = element("a");
    			img7 = element("img");
    			t48 = space();
    			section3 = element("section");
    			div24 = element("div");
    			p6 = element("p");
    			p6.textContent = "- APPLICATIONS -";
    			t50 = space();
    			div20 = element("div");
    			a8 = element("a");
    			div18 = element("div");
    			img8 = element("img");
    			t51 = space();
    			p7 = element("p");
    			p7.textContent = "Police Application";
    			t53 = space();
    			p8 = element("p");
    			p8.textContent = "Apply for a police job.";
    			t55 = space();
    			a9 = element("a");
    			div19 = element("div");
    			img9 = element("img");
    			t56 = space();
    			p9 = element("p");
    			p9.textContent = "Gang Application";
    			t58 = space();
    			p10 = element("p");
    			p10.textContent = "Apply for a gangster role.";
    			t60 = space();
    			div23 = element("div");
    			a10 = element("a");
    			div21 = element("div");
    			img10 = element("img");
    			t61 = space();
    			p11 = element("p");
    			p11.textContent = "Staff Application";
    			t63 = space();
    			p12 = element("p");
    			p12.textContent = "Apply for a staff role.";
    			t65 = space();
    			a11 = element("a");
    			div22 = element("div");
    			img11 = element("img");
    			t66 = space();
    			p13 = element("p");
    			p13.textContent = "Streamer Application";
    			t68 = space();
    			p14 = element("p");
    			p14.textContent = "Apply for a streamer role.";
    			t70 = space();
    			p15 = element("p");
    			p15.textContent = "Once you apply, wait a while and check our discord server for you application result.";
    			t72 = space();
    			p16 = element("p");
    			p16.textContent = "If you're unsure what role to choose/apply for, you can join our discord server and ask for help/recommendations.";
    			t74 = space();
    			section4 = element("section");
    			div40 = element("div");
    			a12 = element("a");
    			t75 = space();
    			p17 = element("p");
    			p17.textContent = "- SERVER RULES -";
    			t77 = space();
    			div27 = element("div");
    			a13 = element("a");
    			div25 = element("div");
    			img12 = element("img");
    			t78 = space();
    			p18 = element("p");
    			p18.textContent = "General Rules";
    			t80 = space();
    			p19 = element("p");
    			t81 = text("Read It ");
    			span6 = element("span");
    			span6.textContent = "Carefully";
    			t83 = text(".");
    			t84 = space();
    			a14 = element("a");
    			div26 = element("div");
    			img13 = element("img");
    			t85 = space();
    			p20 = element("p");
    			p20.textContent = "Police Rules";
    			t87 = space();
    			p21 = element("p");
    			t88 = text("Read It ");
    			span7 = element("span");
    			span7.textContent = "Carefully";
    			t90 = text(".");
    			t91 = space();
    			div30 = element("div");
    			a15 = element("a");
    			div28 = element("div");
    			img14 = element("img");
    			t92 = space();
    			p22 = element("p");
    			p22.textContent = "Illegal Rules";
    			t94 = space();
    			p23 = element("p");
    			t95 = text("Read It ");
    			span8 = element("span");
    			span8.textContent = "Carefully";
    			t97 = text(".");
    			t98 = space();
    			a16 = element("a");
    			div29 = element("div");
    			img15 = element("img");
    			t99 = space();
    			p24 = element("p");
    			p24.textContent = "Gang War Rules";
    			t101 = space();
    			p25 = element("p");
    			t102 = text("Read It ");
    			span9 = element("span");
    			span9.textContent = "Carefully";
    			t104 = text(".");
    			t105 = space();
    			div33 = element("div");
    			a17 = element("a");
    			div31 = element("div");
    			img16 = element("img");
    			t106 = space();
    			p26 = element("p");
    			p26.textContent = "Crime Rules";
    			t108 = space();
    			p27 = element("p");
    			t109 = text("Read It ");
    			span10 = element("span");
    			span10.textContent = "Carefully";
    			t111 = text(".");
    			t112 = space();
    			a18 = element("a");
    			div32 = element("div");
    			img17 = element("img");
    			t113 = space();
    			p28 = element("p");
    			p28.textContent = "Safe Zone";
    			t115 = space();
    			p29 = element("p");
    			t116 = text("Read It ");
    			span11 = element("span");
    			span11.textContent = "Carefully";
    			t118 = text(".");
    			t119 = space();
    			div36 = element("div");
    			a19 = element("a");
    			div34 = element("div");
    			img18 = element("img");
    			t120 = space();
    			p30 = element("p");
    			p30.textContent = "Ems Rules";
    			t122 = space();
    			p31 = element("p");
    			t123 = text("Read It ");
    			span12 = element("span");
    			span12.textContent = "Carefully";
    			t125 = text(".");
    			t126 = space();
    			a20 = element("a");
    			div35 = element("div");
    			img19 = element("img");
    			t127 = space();
    			p32 = element("p");
    			p32.textContent = "Business";
    			t129 = space();
    			p33 = element("p");
    			t130 = text("Read It ");
    			span13 = element("span");
    			span13.textContent = "Carefully";
    			t132 = text(".");
    			t133 = space();
    			div39 = element("div");
    			a21 = element("a");
    			div37 = element("div");
    			img20 = element("img");
    			t134 = space();
    			p34 = element("p");
    			p34.textContent = "Mort Rp Rules";
    			t136 = space();
    			p35 = element("p");
    			t137 = text("Read It ");
    			span14 = element("span");
    			span14.textContent = "Carefully";
    			t139 = text(".");
    			t140 = space();
    			a22 = element("a");
    			div38 = element("div");
    			img21 = element("img");
    			t141 = space();
    			p36 = element("p");
    			p36.textContent = "Discord";
    			t143 = space();
    			p37 = element("p");
    			t144 = text("Read It ");
    			span15 = element("span");
    			span15.textContent = "Carefully";
    			t146 = text(".");
    			t147 = space();
    			p38 = element("p");
    			p38.textContent = "Attention all players: Please read the rules thoroughly to ensure fair play and a great gaming experience.";
    			t149 = space();
    			p39 = element("p");
    			p39.textContent = "Wishing each and every one of you the best of luck! Let the games begin!.";
    			t151 = space();
    			section5 = element("section");
    			p40 = element("p");
    			t152 = text("Barbaros ");
    			span16 = element("span");
    			span16.textContent = "Special";
    			t154 = text(" Perks!");
    			t155 = space();
    			div44 = element("div");
    			div41 = element("div");
    			a23 = element("a");
    			img22 = element("img");
    			t156 = space();
    			p41 = element("p");
    			p41.textContent = "Immerse yourself in endless adventures and captivating narratives with our cutting-edge role-play online company. Discover boundless possibilities and unleash your imagination like never before!.";
    			t158 = space();
    			div42 = element("div");
    			a24 = element("a");
    			img23 = element("img");
    			t159 = space();
    			p42 = element("p");
    			p42.textContent = "Enhance your virtual driving experience with our thrilling role-play online vehicle add-on. Unleash the speed, power, and adrenaline as you embark on epic journeys in the digital realm!";
    			t161 = space();
    			div43 = element("div");
    			a25 = element("a");
    			img24 = element("img");
    			t162 = space();
    			p43 = element("p");
    			p43.textContent = "Inject life into your virtual world with our immersive role-play online peds add-on. Interact with diverse and dynamic characters, shaping unforgettable stories with every encounter!";
    			t164 = space();
    			section6 = element("section");
    			img25 = element("img");
    			t165 = space();
    			p44 = element("p");
    			t166 = text("Join A ");
    			span17 = element("span");
    			span17.textContent = "Friendly";
    			t168 = text(" Community!");
    			t169 = space();
    			p45 = element("p");
    			p45.textContent = "Barbaros FiveM Server is much more than just a gaming server, it's a community. Our players are friendly, welcoming and always ready to help new players get started. We have an active discord where you can connect with other players, share tips and just hang out. With a thriving community of players from Tunisia and around the world, Barbaros is the perfect place to make new friends and play together.";
    			t171 = space();
    			center = element("center");
    			div65 = element("div");
    			div64 = element("div");
    			div45 = element("div");
    			img26 = element("img");
    			t172 = space();
    			div46 = element("div");
    			img27 = element("img");
    			t173 = space();
    			div47 = element("div");
    			img28 = element("img");
    			t174 = space();
    			div48 = element("div");
    			img29 = element("img");
    			t175 = space();
    			div49 = element("div");
    			img30 = element("img");
    			t176 = space();
    			div50 = element("div");
    			img31 = element("img");
    			t177 = space();
    			div51 = element("div");
    			img32 = element("img");
    			t178 = space();
    			div52 = element("div");
    			img33 = element("img");
    			t179 = space();
    			div53 = element("div");
    			img34 = element("img");
    			t180 = space();
    			div54 = element("div");
    			img35 = element("img");
    			t181 = space();
    			div55 = element("div");
    			img36 = element("img");
    			t182 = space();
    			div56 = element("div");
    			img37 = element("img");
    			t183 = space();
    			div57 = element("div");
    			img38 = element("img");
    			t184 = space();
    			div58 = element("div");
    			img39 = element("img");
    			t185 = space();
    			div59 = element("div");
    			img40 = element("img");
    			t186 = space();
    			div60 = element("div");
    			img41 = element("img");
    			t187 = space();
    			div61 = element("div");
    			img42 = element("img");
    			t188 = space();
    			div62 = element("div");
    			img43 = element("img");
    			t189 = space();
    			div63 = element("div");
    			img44 = element("img");
    			t190 = space();
    			button2 = element("button");
    			span19 = element("span");
    			svg3 = svg_element("svg");
    			path3 = svg_element("path");
    			t191 = space();
    			span18 = element("span");
    			span18.textContent = "Previous";
    			t193 = space();
    			button3 = element("button");
    			span21 = element("span");
    			svg4 = svg_element("svg");
    			path4 = svg_element("path");
    			t194 = space();
    			span20 = element("span");
    			span20.textContent = "Next";
    			t196 = space();
    			section7 = element("section");
    			footer = element("footer");
    			div72 = element("div");
    			div70 = element("div");
    			div66 = element("div");
    			a26 = element("a");
    			img45 = element("img");
    			t197 = space();
    			div69 = element("div");
    			div67 = element("div");
    			h21 = element("h2");
    			h21.textContent = "Resources";
    			t199 = space();
    			ul1 = element("ul");
    			li5 = element("li");
    			a27 = element("a");
    			a27.textContent = "Rules";
    			t201 = space();
    			li6 = element("li");
    			a28 = element("a");
    			a28.textContent = "How to join";
    			t203 = space();
    			div68 = element("div");
    			h22 = element("h2");
    			h22.textContent = "Follow us";
    			t205 = space();
    			ul2 = element("ul");
    			li7 = element("li");
    			a29 = element("a");
    			a29.textContent = "Discord";
    			t207 = space();
    			li8 = element("li");
    			a30 = element("a");
    			a30.textContent = "YouTube";
    			t209 = space();
    			hr = element("hr");
    			t210 = space();
    			div71 = element("div");
    			span22 = element("span");
    			a31 = element("a");
    			a31.textContent = "Barbaros RP";
    			t212 = text(" - Developed By ");
    			a32 = element("a");
    			a32.textContent = "salim-dev11";
    			t214 = text(" & ");
    			a33 = element("a");
    			a33.textContent = "akatiggerx04";
    			t216 = text(".");
    			t217 = space();
    			section8 = element("section");
    			div73 = element("div");
    			button4 = element("button");
    			svg5 = svg_element("svg");
    			path5 = svg_element("path");
    			path6 = svg_element("path");
    			t218 = space();
    			p46 = element("p");
    			p46.textContent = "Connect Via IP:";
    			t220 = space();
    			input = element("input");
    			t221 = space();
    			p47 = element("p");
    			p47.textContent = "OR";
    			t223 = space();
    			a34 = element("a");
    			a34.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img0.src, img0_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img0, "src", img0_src_value);
    			attr_dev(img0, "class", "h-14 mr-3 mt-1");
    			attr_dev(img0, "alt", "Barbaros Logo");
    			add_location(img0, file, 39, 4, 1393);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file, 38, 3, 1350);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file, 42, 4, 1527);
    			attr_dev(span0, "class", "sr-only");
    			add_location(span0, file, 44, 4, 2125);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file, 46, 5, 2286);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file, 45, 4, 2173);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file, 43, 4, 1773);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file, 41, 3, 1493);
    			attr_dev(a1, "href", "/#bas");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file, 54, 4, 2719);
    			add_location(li0, file, 52, 4, 2660);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file, 57, 4, 2823);
    			add_location(li1, file, 56, 4, 2814);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file, 60, 5, 2938);
    			add_location(li2, file, 59, 4, 2928);
    			attr_dev(a4, "href", "#tutorial");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file, 63, 4, 3041);
    			add_location(li3, file, 62, 4, 3032);
    			attr_dev(a5, "href", "https://discord.gg/barbaros");
    			attr_dev(a5, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a5, file, 66, 4, 3148);
    			add_location(li4, file, 65, 4, 3139);
    			attr_dev(ul0, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul0, file, 51, 3, 2549);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file, 50, 3, 2444);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file, 37, 3, 1261);
    			add_location(nav, file, 36, 2, 1252);
    			attr_dev(div3, "class", "mt-2");
    			add_location(div3, file, 76, 119, 3531);
    			attr_dev(span1, "class", "font-semibold bg-red-700 rounded px-2");
    			add_location(span1, file, 76, 143, 3555);
    			attr_dev(h20, "class", "text-white font-medium text-5xl z-0 text-left absolute top-16 left-16 -rotate-2");
    			add_location(h20, file, 76, 5, 3417);
    			attr_dev(div4, "class", "block w-2/4 relative");
    			add_location(div4, file, 75, 4, 3377);
    			if (!src_url_equal(img1.src, img1_src_value = "/assets/img/guys-hero.webp")) attr_dev(img1, "src", img1_src_value);
    			attr_dev(img1, "alt", "Barbaros Artwork");
    			attr_dev(img1, "class", "z-10");
    			add_location(img1, file, 78, 4, 3654);
    			attr_dev(path1, "d", "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10Z");
    			add_location(path1, file, 81, 98, 4056);
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "fill", "currentColor");
    			attr_dev(svg1, "class", "w-8");
    			attr_dev(svg1, "viewBox", "0 0 16 16");
    			add_location(svg1, file, 81, 6, 3964);
    			attr_dev(span2, "class", "ml-1");
    			attr_dev(span2, "id", "player-count");
    			add_location(span2, file, 82, 6, 4322);
    			attr_dev(p0, "class", "text-4xl font-semibold inline-flex items-center");
    			add_location(p0, file, 80, 5, 3898);
    			attr_dev(span3, "class", "font-bold");
    			add_location(span3, file, 84, 38, 4416);
    			attr_dev(p1, "class", "text-3xl text-red-700");
    			add_location(p1, file, 84, 5, 4383);
    			attr_dev(div5, "class", "bg-white absolute bottom-10 z-50 px-6 py-5 rounded-t drop-shadow-xl border-l-2 border-l-red-700 border-t-2 border-t-red-700");
    			set_style(div5, "rotate", "-2deg");
    			add_location(div5, file, 79, 4, 3733);
    			attr_dev(div6, "class", "flex flex-col items-center mt-8");
    			add_location(div6, file, 74, 3, 3327);
    			attr_dev(section0, "class", "relative");
    			add_location(section0, file, 73, 2, 3297);
    			if (!src_url_equal(img2.src, img2_src_value = "/assets/img/fly-header-1.png")) attr_dev(img2, "src", img2_src_value);
    			attr_dev(img2, "class", "absolute left-0");
    			attr_dev(img2, "alt", "Transition");
    			set_style(img2, "top", "-250px");
    			set_style(img2, "z-index", "200");
    			add_location(img2, file, 90, 3, 4529);
    			if (!src_url_equal(img3.src, img3_src_value = "/assets/img/fly-header-2.png")) attr_dev(img3, "src", img3_src_value);
    			attr_dev(img3, "class", "absolute right-0 w-48");
    			attr_dev(img3, "alt", "Transition");
    			set_style(img3, "top", "-200px");
    			set_style(img3, "z-index", "200");
    			add_location(img3, file, 91, 3, 4649);
    			attr_dev(path2, "d", "M1200 120L0 16.48 0 0 1200 0 1200 120z");
    			attr_dev(path2, "class", "shape-fill svelte-1t06wmr");
    			add_location(path2, file, 94, 5, 4948);
    			attr_dev(svg2, "data-name", "Layer 1");
    			attr_dev(svg2, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg2, "viewBox", "0 0 1200 120");
    			attr_dev(svg2, "preserveAspectRatio", "none");
    			attr_dev(svg2, "class", "svelte-1t06wmr");
    			add_location(svg2, file, 93, 4, 4832);
    			attr_dev(div7, "class", "custom-shape-divider-bottom-1689849633 svelte-1t06wmr");
    			add_location(div7, file, 92, 3, 4775);
    			attr_dev(div8, "class", "relative");
    			add_location(div8, file, 89, 2, 4503);
    			attr_dev(div9, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(div9, file, 35, 1, 1177);
    			attr_dev(span4, "class", "text-[#2F344F]");
    			add_location(span4, file, 104, 118, 5351);
    			attr_dev(p2, "class", "absolute top-0 text-9xl font-medium -rotate-3 drop-shadow-xl text-red-700");
    			set_style(p2, "z-index", "-1");
    			add_location(p2, file, 104, 5, 5238);
    			attr_dev(iframe, "frameborder", "0");
    			attr_dev(iframe, "scrolling", "no");
    			attr_dev(iframe, "marginheight", "0");
    			attr_dev(iframe, "marginwidth", "0");
    			attr_dev(iframe, "width", "1000px");
    			attr_dev(iframe, "height", "443");
    			attr_dev(iframe, "type", "text/html");
    			iframe.allowFullscreen = true;
    			if (!src_url_equal(iframe.src, iframe_src_value = "https://www.youtube.com/embed/BV5mxn6QpwU?autoplay=1&mute=1&fs=1&iv_load_policy=3&showinfo=0&rel=0&cc_load_policy=0&start=0&end=0&vq=hd1080")) attr_dev(iframe, "src", iframe_src_value);
    			add_location(iframe, file, 107, 114, 5674);
    			attr_dev(a6, "href", "https://www.embedista.com/embed-youtube-video");
    			add_location(a6, file, 107, 619, 6179);
    			set_style(div10, "overflow", "auto");
    			set_style(div10, "position", "absolute");
    			set_style(div10, "height", "0pt");
    			set_style(div10, "width", "0pt");
    			add_location(div10, file, 107, 532, 6092);
    			attr_dev(script, "type", "text/javascript");
    			if (!src_url_equal(script.src, script_src_value = "https://www.embedista.com/j/ytvideo.js")) attr_dev(script, "src", script_src_value);
    			add_location(script, file, 107, 711, 6271);
    			set_style(div11, "position", "absolute");
    			set_style(div11, "bottom", "10px");
    			set_style(div11, "left", "0");
    			set_style(div11, "right", "0");
    			set_style(div11, "margin-left", "auto");
    			set_style(div11, "margin-right", "auto");
    			set_style(div11, "color", "#000");
    			set_style(div11, "text-align", "center");
    			add_location(div11, file, 107, 401, 5961);
    			add_location(style, file, 107, 802, 6362);
    			attr_dev(div12, "style", "overflow:hidden;position: relative; rotate : -3.5deg ; margin-top : 65px ; border-radius : 10px");
    			add_location(div12, file, 107, 5, 5565);
    			add_location(br, file, 107, 960, 6520);
    			attr_dev(div13, "class", "relative ml-60 mt-4");
    			add_location(div13, file, 102, 3, 5115);
    			if (!src_url_equal(img4.src, img4_src_value = "/assets/img/npc.png")) attr_dev(img4, "src", img4_src_value);
    			attr_dev(img4, "alt", "NPC");
    			set_style(img4, "width", "100%");
    			set_style(img4, "z-index", "200");
    			attr_dev(img4, "class", "-mt-48");
    			add_location(img4, file, 111, 4, 6591);
    			set_style(div14, "z-index", "200");
    			add_location(div14, file, 110, 3, 6559);
    			attr_dev(div15, "class", "flex");
    			add_location(div15, file, 101, 2, 5093);
    			attr_dev(p3, "class", "font-semibold text-3xl");
    			add_location(p3, file, 115, 3, 6829);
    			attr_dev(span5, "class", "text-red-700 font-bold");
    			add_location(span5, file, 116, 23, 6900);
    			attr_dev(p4, "class", "text-4xl");
    			add_location(p4, file, 116, 3, 6880);
    			attr_dev(p5, "class", "text-3xl");
    			add_location(p5, file, 117, 3, 6973);
    			attr_dev(div16, "class", "text-[#2F344F] h-48 absolute -bottom-24 block");
    			attr_dev(div16, "style", "rotate: -3.5deg; margin-left : 240px ;");
    			attr_dev(div16, "id", "tutorial");
    			add_location(div16, file, 114, 2, 6704);
    			attr_dev(section1, "class", "relative");
    			add_location(section1, file, 100, 1, 5064);
    			if (!src_url_equal(img5.src, img5_src_value = "/assets/img/hero-2-tutorial.webp")) attr_dev(img5, "src", img5_src_value);
    			attr_dev(img5, "alt", "Tutorial");
    			set_style(img5, "width", "80%");
    			attr_dev(img5, "class", "-mt-14 ml-24");
    			add_location(img5, file, 123, 3, 7073);
    			if (!src_url_equal(img6.src, img6_src_value = "/assets/img/fly-slider-2.png")) attr_dev(img6, "src", img6_src_value);
    			attr_dev(img6, "alt", "Object");
    			attr_dev(img6, "class", "absolute bottom-0 right-0");
    			add_location(img6, file, 124, 3, 7177);
    			if (!src_url_equal(img7.src, img7_src_value = "/assets/img/tl-btn.webp")) attr_dev(img7, "src", img7_src_value);
    			attr_dev(img7, "alt", "Watch");
    			attr_dev(img7, "class", "absolute top-0 right-24 w-96 -mt-10 hover:-mt-8 duration-300");
    			set_style(img7, "z-index", "700");
    			add_location(img7, file, 126, 4, 7329);
    			attr_dev(a7, "href", "https://youtu.be/p-KGR8WanZg");
    			attr_dev(a7, "target", "_blank");
    			add_location(a7, file, 125, 3, 7269);
    			attr_dev(div17, "class", "relative");
    			add_location(div17, file, 122, 2, 7047);
    			add_location(section2, file, 121, 1, 7035);
    			attr_dev(p6, "class", "text-white font-bold text-7xl pb-2");
    			set_style(p6, "rotate", "-3.5deg");
    			add_location(p6, file, 133, 3, 7704);
    			if (!src_url_equal(img8.src, img8_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133548827467599892/police-npc.png?width=493&height=671")) attr_dev(img8, "src", img8_src_value);
    			attr_dev(img8, "alt", "Police Logo");
    			attr_dev(img8, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img8, "height", "10.375rem");
    			add_location(img8, file, 137, 6, 8061);
    			attr_dev(p7, "class", "text-3xl");
    			add_location(p7, file, 138, 6, 8280);
    			attr_dev(p8, "class", "text-xl");
    			add_location(p8, file, 139, 6, 8329);
    			attr_dev(div18, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div18, "rotate", "-3.5deg");
    			set_style(div18, "width", "400px");
    			add_location(div18, file, 136, 5, 7905);
    			attr_dev(a8, "href", "https://forms.gle/Ns4sdSiH5VvVuEAs6");
    			attr_dev(a8, "class", "mx-8");
    			add_location(a8, file, 135, 4, 7839);
    			if (!src_url_equal(img9.src, img9_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133548835436757132/gang-npc.png")) attr_dev(img9, "src", img9_src_value);
    			attr_dev(img9, "alt", "Gangster Logo");
    			attr_dev(img9, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img9, "height", "10.375rem");
    			add_location(img9, file, 145, 6, 8631);
    			attr_dev(p9, "class", "text-3xl");
    			add_location(p9, file, 146, 6, 8829);
    			attr_dev(p10, "class", "text-xl");
    			add_location(p10, file, 147, 6, 8876);
    			attr_dev(div19, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div19, "rotate", "-3.5deg");
    			set_style(div19, "width", "400px");
    			add_location(div19, file, 144, 5, 8475);
    			attr_dev(a9, "href", "https://forms.gle/ULMc8RT5K37ZBHdc7");
    			attr_dev(a9, "class", "mx-8 -mt-10");
    			add_location(a9, file, 143, 4, 8402);
    			attr_dev(div20, "class", "flex flex-nowrap pt-48");
    			add_location(div20, file, 134, 3, 7798);
    			if (!src_url_equal(img10.src, img10_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133548066432090113/staff.png")) attr_dev(img10, "src", img10_src_value);
    			attr_dev(img10, "alt", "Staff Icon");
    			attr_dev(img10, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img10, "height", "7rem");
    			add_location(img10, file, 154, 6, 9238);
    			attr_dev(p11, "class", "text-3xl");
    			add_location(p11, file, 155, 6, 9425);
    			attr_dev(p12, "class", "text-xl");
    			add_location(p12, file, 156, 6, 9473);
    			attr_dev(div21, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div21, "rotate", "-3.5deg");
    			set_style(div21, "width", "400px");
    			add_location(div21, file, 153, 5, 9082);
    			attr_dev(a10, "href", "https://my.forms.app/form/63c3dcf8597af40147bf0fe8");
    			attr_dev(a10, "class", "mx-8");
    			add_location(a10, file, 152, 4, 9001);
    			if (!src_url_equal(img11.src, img11_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133548052540567655/streamer2.png")) attr_dev(img11, "src", img11_src_value);
    			attr_dev(img11, "alt", "Streamer Icon");
    			attr_dev(img11, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img11, "height", "8rem");
    			add_location(img11, file, 162, 6, 9790);
    			attr_dev(p13, "class", "text-3xl");
    			add_location(p13, file, 163, 6, 9984);
    			attr_dev(p14, "class", "text-xl");
    			add_location(p14, file, 164, 6, 10035);
    			attr_dev(div22, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div22, "rotate", "-3.5deg");
    			set_style(div22, "width", "400px");
    			add_location(div22, file, 161, 5, 9634);
    			attr_dev(a11, "href", "https://my.forms.app/form/63cedb45597af40147cdec57");
    			attr_dev(a11, "class", "mx-8 -mt-10");
    			add_location(a11, file, 160, 4, 9546);
    			attr_dev(div23, "class", "flex flex-nowrap pt-10");
    			add_location(div23, file, 151, 3, 8960);
    			attr_dev(p15, "class", "text-white text-lg mt-8");
    			set_style(p15, "rotate", "-3.5deg");
    			add_location(p15, file, 168, 3, 10119);
    			attr_dev(p16, "class", "text-white text-lg opacity-70");
    			set_style(p16, "rotate", "-3.5deg");
    			add_location(p16, file, 169, 3, 10271);
    			attr_dev(div24, "class", "flex flex-col items-center justify-center");
    			set_style(div24, "padding-top", "15rem");
    			set_style(div24, "padding-bottom", "15rem");
    			add_location(div24, file, 132, 2, 7594);
    			attr_dev(section3, "class", "bg-[url('/assets/img/purple-bg.webp')] bg-cover bg-no-repeat w-full -mt-24");
    			add_location(section3, file, 131, 1, 7499);
    			attr_dev(a12, "name", "bas");
    			add_location(a12, file, 178, 2, 10750);
    			attr_dev(p17, "class", "text-white font-bold text-7xl pb-2");
    			set_style(p17, "rotate", "-3.5deg");
    			add_location(p17, file, 179, 2, 10771);
    			if (!src_url_equal(img12.src, img12_src_value = "/assets/img/generalrules.png")) attr_dev(img12, "src", img12_src_value);
    			attr_dev(img12, "alt", "NPC");
    			attr_dev(img12, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img12, "height", "8.375rem");
    			add_location(img12, file, 184, 5, 11099);
    			attr_dev(p18, "class", "text-3xl");
    			add_location(p18, file, 185, 5, 11220);
    			set_style(span6, "color", "red");
    			add_location(span6, file, 186, 32, 11290);
    			attr_dev(p19, "class", "text-xl");
    			add_location(p19, file, 186, 5, 11263);
    			attr_dev(div25, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div25, "rotate", "-3.5deg");
    			set_style(div25, "width", "400px");
    			add_location(div25, file, 183, 4, 10944);
    			attr_dev(a13, "href", "/#/rules");
    			attr_dev(a13, "class", "mx-8");
    			add_location(a13, file, 182, 3, 10907);
    			if (!src_url_equal(img13.src, img13_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133548827467599892/police-npc.png?width=493&height=671")) attr_dev(img13, "src", img13_src_value);
    			attr_dev(img13, "alt", "NPC");
    			attr_dev(img13, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img13, "height", "9.375rem");
    			add_location(img13, file, 193, 5, 11658);
    			attr_dev(p20, "class", "text-3xl");
    			add_location(p20, file, 194, 5, 11867);
    			set_style(span7, "color", "red");
    			add_location(span7, file, 195, 32, 11936);
    			attr_dev(p21, "class", "text-xl");
    			add_location(p21, file, 195, 5, 11909);
    			attr_dev(div26, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div26, "rotate", "-3.5deg");
    			set_style(div26, "width", "400px");
    			add_location(div26, file, 191, 4, 11403);
    			attr_dev(a14, "href", "/#/p");
    			attr_dev(a14, "class", "mx-8 -mt-10");
    			add_location(a14, file, 190, 3, 11362);
    			attr_dev(div27, "class", "flex flex-nowrap pt-48");
    			add_location(div27, file, 181, 2, 10867);
    			if (!src_url_equal(img14.src, img14_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133548835436757132/gang-npc.png")) attr_dev(img14, "src", img14_src_value);
    			attr_dev(img14, "alt", "NPC");
    			attr_dev(img14, "class", "absolute bottom-0 right-0");
    			set_style(img14, "height", "9.375rem");
    			add_location(img14, file, 202, 5, 12249);
    			attr_dev(p22, "class", "text-3xl");
    			add_location(p22, file, 203, 5, 12430);
    			set_style(span8, "color", "red");
    			add_location(span8, file, 204, 32, 12500);
    			attr_dev(p23, "class", "text-xl");
    			add_location(p23, file, 204, 5, 12473);
    			attr_dev(div28, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div28, "rotate", "-3.5deg");
    			set_style(div28, "width", "400px");
    			add_location(div28, file, 201, 4, 12094);
    			attr_dev(a15, "href", "/#/illegal");
    			attr_dev(a15, "class", "mx-8");
    			add_location(a15, file, 200, 3, 12054);
    			if (!src_url_equal(img15.src, img15_src_value = "/assets/img/gangwar.png")) attr_dev(img15, "src", img15_src_value);
    			attr_dev(img15, "alt", "NPC");
    			attr_dev(img15, "class", "absolute bottom-0 right-0");
    			set_style(img15, "height", "5.375rem");
    			add_location(img15, file, 210, 5, 12773);
    			attr_dev(p24, "class", "text-3xl");
    			add_location(p24, file, 211, 5, 12884);
    			set_style(span9, "color", "red");
    			add_location(span9, file, 212, 32, 12955);
    			attr_dev(p25, "class", "text-xl");
    			add_location(p25, file, 212, 5, 12928);
    			attr_dev(div29, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div29, "rotate", "-3.5deg");
    			set_style(div29, "width", "400px");
    			add_location(div29, file, 209, 4, 12618);
    			attr_dev(a16, "href", "/#/gangwar");
    			attr_dev(a16, "class", "mx-8 -mt-10");
    			add_location(a16, file, 208, 3, 12571);
    			attr_dev(div30, "class", "flex flex-nowrap pt-10");
    			add_location(div30, file, 199, 2, 12014);
    			if (!src_url_equal(img16.src, img16_src_value = "/assets/img/crime.png")) attr_dev(img16, "src", img16_src_value);
    			attr_dev(img16, "alt", "NPC");
    			attr_dev(img16, "class", "absolute bottom-0 right-0");
    			attr_dev(img16, "style", "height: 7.375rem; color :white ; ");
    			add_location(img16, file, 219, 5, 13267);
    			attr_dev(p26, "class", "text-3xl");
    			add_location(p26, file, 220, 5, 13392);
    			set_style(span10, "color", "red");
    			add_location(span10, file, 221, 32, 13460);
    			attr_dev(p27, "class", "text-xl");
    			add_location(p27, file, 221, 5, 13433);
    			attr_dev(div31, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div31, "rotate", "-3.5deg");
    			set_style(div31, "width", "400px");
    			add_location(div31, file, 218, 4, 13112);
    			attr_dev(a17, "href", "/#/crime");
    			attr_dev(a17, "class", "mx-8");
    			add_location(a17, file, 217, 3, 13074);
    			if (!src_url_equal(img17.src, img17_src_value = "/assets/img/safezone.png")) attr_dev(img17, "src", img17_src_value);
    			attr_dev(img17, "alt", "NPC");
    			attr_dev(img17, "class", "absolute bottom-0 right-0");
    			set_style(img17, "height", "7.375rem");
    			add_location(img17, file, 226, 5, 13729);
    			attr_dev(p28, "class", "text-3xl");
    			add_location(p28, file, 227, 5, 13841);
    			set_style(span11, "color", "red");
    			add_location(span11, file, 228, 32, 13907);
    			attr_dev(p29, "class", "text-xl");
    			add_location(p29, file, 228, 5, 13880);
    			attr_dev(div32, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div32, "rotate", "-3.5deg");
    			set_style(div32, "width", "400px");
    			add_location(div32, file, 225, 4, 13574);
    			attr_dev(a18, "href", "/#/safe");
    			attr_dev(a18, "class", "mx-8 -mt-10");
    			add_location(a18, file, 224, 3, 13530);
    			attr_dev(div33, "class", "flex flex-nowrap pt-10");
    			add_location(div33, file, 216, 2, 13034);
    			if (!src_url_equal(img18.src, img18_src_value = "/assets/img/ems.png")) attr_dev(img18, "src", img18_src_value);
    			attr_dev(img18, "alt", "NPC");
    			attr_dev(img18, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img18, "height", "6.25rem");
    			add_location(img18, file, 235, 5, 14219);
    			attr_dev(p30, "class", "text-3xl");
    			add_location(p30, file, 236, 5, 14330);
    			set_style(span12, "color", "red");
    			add_location(span12, file, 237, 32, 14396);
    			attr_dev(p31, "class", "text-xl");
    			add_location(p31, file, 237, 5, 14369);
    			attr_dev(div34, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div34, "rotate", "-3.5deg");
    			set_style(div34, "width", "400px");
    			add_location(div34, file, 234, 4, 14064);
    			attr_dev(a19, "href", "/#/ems");
    			attr_dev(a19, "class", "mx-8");
    			add_location(a19, file, 233, 3, 14028);
    			if (!src_url_equal(img19.src, img19_src_value = "/assets/img/business.png")) attr_dev(img19, "src", img19_src_value);
    			attr_dev(img19, "alt", "NPC");
    			attr_dev(img19, "class", "absolute bottom-0 right-0");
    			set_style(img19, "height", "7.5rem");
    			add_location(img19, file, 242, 5, 14669);
    			attr_dev(p32, "class", "text-3xl");
    			add_location(p32, file, 243, 5, 14779);
    			set_style(span13, "color", "red");
    			add_location(span13, file, 244, 32, 14844);
    			attr_dev(p33, "class", "text-xl");
    			add_location(p33, file, 244, 5, 14817);
    			attr_dev(div35, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div35, "rotate", "-3.5deg");
    			set_style(div35, "width", "400px");
    			add_location(div35, file, 241, 4, 14514);
    			attr_dev(a20, "href", "/#/business");
    			attr_dev(a20, "class", "mx-8 -mt-10");
    			add_location(a20, file, 240, 3, 14466);
    			attr_dev(div36, "class", "flex flex-nowrap pt-10");
    			add_location(div36, file, 232, 2, 13988);
    			if (!src_url_equal(img20.src, img20_src_value = "/assets/img/mortrp.png")) attr_dev(img20, "src", img20_src_value);
    			attr_dev(img20, "alt", "NPC");
    			attr_dev(img20, "class", "absolute bottom-0 right-0 h-64");
    			set_style(img20, "height", "6.25rem");
    			add_location(img20, file, 251, 5, 15158);
    			attr_dev(p34, "class", "text-3xl");
    			add_location(p34, file, 252, 5, 15272);
    			set_style(span14, "color", "red");
    			add_location(span14, file, 253, 32, 15342);
    			attr_dev(p35, "class", "text-xl");
    			add_location(p35, file, 253, 5, 15315);
    			attr_dev(div37, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div37, "rotate", "-3.5deg");
    			set_style(div37, "width", "400px");
    			add_location(div37, file, 250, 4, 15003);
    			attr_dev(a21, "href", "/#/mortrp");
    			attr_dev(a21, "class", "mx-8");
    			add_location(a21, file, 249, 3, 14964);
    			if (!src_url_equal(img21.src, img21_src_value = "/assets/img/discord.png")) attr_dev(img21, "src", img21_src_value);
    			attr_dev(img21, "alt", "NPC");
    			attr_dev(img21, "class", "absolute bottom-0 right-0");
    			set_style(img21, "height", "7.375rem");
    			add_location(img21, file, 258, 5, 15614);
    			attr_dev(p36, "class", "text-3xl");
    			add_location(p36, file, 259, 5, 15725);
    			set_style(span15, "color", "red");
    			add_location(span15, file, 260, 32, 15789);
    			attr_dev(p37, "class", "text-xl");
    			add_location(p37, file, 260, 5, 15762);
    			attr_dev(div38, "class", "py-2 px-4 border-2 border-white text-white hover:bg-white hover:text-black duration-200 relative");
    			set_style(div38, "rotate", "-3.5deg");
    			set_style(div38, "width", "400px");
    			add_location(div38, file, 257, 4, 15459);
    			attr_dev(a22, "href", "/#/discord");
    			attr_dev(a22, "class", "mx-8 -mt-10");
    			add_location(a22, file, 256, 3, 15412);
    			attr_dev(div39, "class", "flex flex-nowrap pt-10");
    			add_location(div39, file, 248, 2, 14924);
    			attr_dev(p38, "class", "text-white text-lg mt-8");
    			set_style(p38, "rotate", "-3.5deg");
    			add_location(p38, file, 264, 2, 15867);
    			attr_dev(p39, "class", "text-white text-lg opacity-70");
    			set_style(p39, "rotate", "-3.5deg");
    			add_location(p39, file, 265, 2, 16039);
    			attr_dev(div40, "class", "flex flex-col items-center justify-center ");
    			set_style(div40, "padding-top", "15rem");
    			set_style(div40, "padding-bottom", "15rem");
    			add_location(div40, file, 176, 1, 10594);
    			attr_dev(section4, "class", "bg-[url('/assets/img/purple-bg.webp')] bg-cover bg-no-repeat w-full -mt-24 ");
    			add_location(section4, file, 175, 0, 10499);
    			attr_dev(span16, "class", "text-[#7C5BF1]");
    			add_location(span16, file, 274, 80, 16698);
    			set_style(p40, "rotate", "-3.5deg");
    			attr_dev(p40, "class", "text-5xl font-bold text-[#2F344F] ");
    			add_location(p40, file, 274, 0, 16618);
    			if (!src_url_equal(img22.src, img22_src_value = "/assets/img/BR_companypng.png")) attr_dev(img22, "src", img22_src_value);
    			attr_dev(img22, "style", "rotate: -3.5deg; height : 260px ;");
    			attr_dev(img22, "class", "mt-8 rounded svelte-1t06wmr");
    			attr_dev(img22, "id", "perks");
    			add_location(img22, file, 278, 26, 16987);
    			attr_dev(a23, "href", "/#/companies");
    			add_location(a23, file, 278, 3, 16964);
    			attr_dev(p41, "class", "text-black text-lg mt-2 text-center");
    			set_style(p41, "rotate", "-3.5deg");
    			add_location(p41, file, 279, 3, 17110);
    			attr_dev(div41, "style", "width : 450px; ");
    			attr_dev(div41, "class", "mt-8");
    			add_location(div41, file, 276, 2, 16869);
    			if (!src_url_equal(img23.src, img23_src_value = "/assets/img/br-vehicles.webp")) attr_dev(img23, "src", img23_src_value);
    			attr_dev(img23, "style", "rotate: -3.5deg; height : 260px; width:auto;");
    			attr_dev(img23, "class", "mt-8 rounded svelte-1t06wmr");
    			attr_dev(img23, "id", "perks");
    			add_location(img23, file, 283, 20, 17526);
    			attr_dev(a24, "href", "/#/car");
    			add_location(a24, file, 283, 3, 17509);
    			attr_dev(p42, "class", "text-black text-lg mt-2 text-center");
    			set_style(p42, "rotate", "-3.5deg");
    			set_style(p42, "width", "530px");
    			add_location(p42, file, 284, 3, 17659);
    			attr_dev(div42, "style", "width : 500px; margin-right : 35px ; ");
    			attr_dev(div42, "class", "mt-8");
    			add_location(div42, file, 281, 2, 17392);
    			if (!src_url_equal(img24.src, img24_src_value = "/assets/img/br_peds.webp")) attr_dev(img24, "src", img24_src_value);
    			attr_dev(img24, "style", "rotate: -3.5deg; height : 270px; width:auto;");
    			attr_dev(img24, "class", "mt-8 rounded svelte-1t06wmr");
    			attr_dev(img24, "id", "perks");
    			add_location(img24, file, 288, 21, 18081);
    			attr_dev(a25, "href", "/#/peds");
    			add_location(a25, file, 288, 3, 18063);
    			attr_dev(p43, "class", "text-black text-lg mt-2 text-center");
    			set_style(p43, "rotate", "-3.5deg");
    			set_style(p43, "width", "450px");
    			add_location(p43, file, 289, 3, 18210);
    			attr_dev(div43, "style", "width : 450px; margin-right : 5px ; ");
    			attr_dev(div43, "class", "mt-8");
    			add_location(div43, file, 286, 2, 17947);
    			attr_dev(div44, "class", "flex flex-wrap");
    			attr_dev(div44, "style", "margin-top: 13px; justify-content : space-around ; align-items : center ; ");
    			add_location(div44, file, 275, 1, 16754);
    			attr_dev(section5, "class", "flex flex-col items-center relative");
    			add_location(section5, file, 273, 0, 16564);
    			if (!src_url_equal(img25.src, img25_src_value = "/assets/img/left-fly-community.png")) attr_dev(img25, "src", img25_src_value);
    			attr_dev(img25, "alt", "Object");
    			attr_dev(img25, "class", "absolute right-0");
    			add_location(img25, file, 296, 1, 18575);
    			attr_dev(span17, "class", "text-[#7C5BF1]");
    			add_location(span17, file, 297, 90, 18750);
    			set_style(p44, "rotate", "-3.5deg");
    			attr_dev(p44, "class", "text-5xl font-bold text-[#2F344F] text-center");
    			add_location(p44, file, 297, 1, 18661);
    			set_style(p45, "rotate", "-3.5deg");
    			attr_dev(p45, "class", "text-lg mt-4 text-[#2F344F] text-center w-2/4");
    			add_location(p45, file, 298, 1, 18811);
    			attr_dev(section6, "class", "flex flex-col items-center relative mt-8");
    			add_location(section6, file, 295, 0, 18515);
    			if (!src_url_equal(img26.src, img26_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350131655458866/picture15.jpg")) attr_dev(img26, "src", img26_src_value);
    			set_style(img26, "width", "800px");
    			attr_dev(img26, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img26, "alt", "");
    			add_location(img26, file, 308, 12, 19746);
    			attr_dev(div45, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div45, "data-carousel-item", "");
    			add_location(div45, file, 307, 3, 19669);
    			if (!src_url_equal(img27.src, img27_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350132456558602/picture14.jpg?width=1310&height=671")) attr_dev(img27, "src", img27_src_value);
    			set_style(img27, "width", "800px");
    			attr_dev(img27, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img27, "alt", "");
    			add_location(img27, file, 313, 12, 20123);
    			attr_dev(div46, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div46, "data-carousel-item", "");
    			add_location(div46, file, 312, 8, 20046);
    			if (!src_url_equal(img28.src, img28_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350131374436403/picture16.jpg?width=1323&height=671")) attr_dev(img28, "src", img28_src_value);
    			set_style(img28, "width", "800px");
    			attr_dev(img28, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img28, "alt", "");
    			add_location(img28, file, 317, 12, 20498);
    			attr_dev(div47, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div47, "data-carousel-item", "");
    			add_location(div47, file, 316, 8, 20421);
    			if (!src_url_equal(img29.src, img29_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350131105992764/picture17.jpg?width=1306&height=671")) attr_dev(img29, "src", img29_src_value);
    			set_style(img29, "width", "800px");
    			attr_dev(img29, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img29, "alt", "");
    			add_location(img29, file, 321, 12, 20868);
    			attr_dev(div48, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div48, "data-carousel-item", "");
    			add_location(div48, file, 320, 2, 20791);
    			if (!src_url_equal(img30.src, img30_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350130820792341/picture10.jpg")) attr_dev(img30, "src", img30_src_value);
    			set_style(img30, "width", "800px");
    			attr_dev(img30, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img30, "alt", "");
    			add_location(img30, file, 324, 12, 21213);
    			attr_dev(div49, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div49, "data-carousel-item", "");
    			add_location(div49, file, 323, 2, 21136);
    			if (!src_url_equal(img31.src, img31_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350130548158536/picture7.jpg?width=1193&height=671")) attr_dev(img31, "src", img31_src_value);
    			set_style(img31, "width", "800px");
    			attr_dev(img31, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img31, "alt", "");
    			add_location(img31, file, 327, 12, 21536);
    			attr_dev(div50, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div50, "data-carousel-item", "");
    			add_location(div50, file, 326, 2, 21459);
    			if (!src_url_equal(img32.src, img32_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350130191634482/picture6.jpg")) attr_dev(img32, "src", img32_src_value);
    			set_style(img32, "width", "800px");
    			attr_dev(img32, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img32, "alt", "");
    			add_location(img32, file, 330, 12, 21880);
    			attr_dev(div51, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div51, "data-carousel-item", "");
    			add_location(div51, file, 329, 2, 21803);
    			if (!src_url_equal(img33.src, img33_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350129898045552/picture4.jpg")) attr_dev(img33, "src", img33_src_value);
    			set_style(img33, "width", "800px");
    			attr_dev(img33, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img33, "alt", "");
    			add_location(img33, file, 333, 12, 22202);
    			attr_dev(div52, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div52, "data-carousel-item", "");
    			add_location(div52, file, 332, 2, 22125);
    			if (!src_url_equal(img34.src, img34_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350129596051477/3ezdin.jpg?width=1074&height=671")) attr_dev(img34, "src", img34_src_value);
    			set_style(img34, "width", "800px");
    			attr_dev(img34, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img34, "alt", "");
    			add_location(img34, file, 336, 12, 22524);
    			attr_dev(div53, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div53, "data-carousel-item", "");
    			add_location(div53, file, 335, 2, 22447);
    			if (!src_url_equal(img35.src, img35_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350056996839556/picture11.jpg")) attr_dev(img35, "src", img35_src_value);
    			set_style(img35, "width", "800px");
    			attr_dev(img35, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img35, "alt", "");
    			add_location(img35, file, 339, 12, 22866);
    			attr_dev(div54, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div54, "data-carousel-item", "");
    			add_location(div54, file, 338, 2, 22789);
    			if (!src_url_equal(img36.src, img36_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350056749387856/picture20.jpg")) attr_dev(img36, "src", img36_src_value);
    			set_style(img36, "width", "800px");
    			attr_dev(img36, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img36, "alt", "");
    			add_location(img36, file, 342, 12, 23189);
    			attr_dev(div55, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div55, "data-carousel-item", "");
    			add_location(div55, file, 341, 2, 23112);
    			if (!src_url_equal(img37.src, img37_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133544123320766534/picture12.png")) attr_dev(img37, "src", img37_src_value);
    			set_style(img37, "width", "800px");
    			attr_dev(img37, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img37, "alt", "");
    			add_location(img37, file, 345, 12, 23512);
    			attr_dev(div56, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div56, "data-carousel-item", "");
    			add_location(div56, file, 344, 2, 23435);
    			if (!src_url_equal(img38.src, img38_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350056455778324/picture21.jpg?width=1305&height=671")) attr_dev(img38, "src", img38_src_value);
    			set_style(img38, "width", "800px");
    			attr_dev(img38, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img38, "alt", "");
    			add_location(img38, file, 348, 12, 23835);
    			attr_dev(div57, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div57, "data-carousel-item", "");
    			add_location(div57, file, 347, 2, 23758);
    			if (!src_url_equal(img39.src, img39_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350055562391653/picture12.jpg")) attr_dev(img39, "src", img39_src_value);
    			set_style(img39, "width", "800px");
    			attr_dev(img39, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img39, "alt", "");
    			add_location(img39, file, 351, 12, 24180);
    			attr_dev(div58, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div58, "data-carousel-item", "");
    			add_location(div58, file, 350, 2, 24103);
    			if (!src_url_equal(img40.src, img40_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350055856001054/picture18.jpg")) attr_dev(img40, "src", img40_src_value);
    			set_style(img40, "width", "800px");
    			attr_dev(img40, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img40, "alt", "");
    			add_location(img40, file, 354, 12, 24503);
    			attr_dev(div59, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div59, "data-carousel-item", "");
    			add_location(div59, file, 353, 2, 24426);
    			if (!src_url_equal(img41.src, img41_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350056195727481/picture3.jpg?width=1193&height=671")) attr_dev(img41, "src", img41_src_value);
    			set_style(img41, "width", "800px");
    			attr_dev(img41, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img41, "alt", "");
    			add_location(img41, file, 357, 12, 24826);
    			attr_dev(div60, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div60, "data-carousel-item", "");
    			add_location(div60, file, 356, 2, 24749);
    			if (!src_url_equal(img42.src, img42_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350008376475779/picture19.jpg")) attr_dev(img42, "src", img42_src_value);
    			set_style(img42, "width", "800px");
    			attr_dev(img42, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img42, "alt", "");
    			add_location(img42, file, 360, 12, 25170);
    			attr_dev(div61, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div61, "data-carousel-item", "");
    			add_location(div61, file, 359, 2, 25093);
    			if (!src_url_equal(img43.src, img43_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135350008070295633/image.jpg")) attr_dev(img43, "src", img43_src_value);
    			set_style(img43, "width", "800px");
    			attr_dev(img43, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img43, "alt", "");
    			add_location(img43, file, 363, 12, 25493);
    			attr_dev(div62, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div62, "data-carousel-item", "");
    			add_location(div62, file, 362, 2, 25416);
    			if (!src_url_equal(img44.src, img44_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1135351160446922812/picture13.jpg")) attr_dev(img44, "src", img44_src_value);
    			set_style(img44, "width", "800px");
    			attr_dev(img44, "class", "absolute block max-w-full h-auto -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2");
    			attr_dev(img44, "alt", "");
    			add_location(img44, file, 366, 12, 25812);
    			attr_dev(div63, "class", "hidden duration-700 ease-in-out");
    			attr_dev(div63, "data-carousel-item", "");
    			add_location(div63, file, 365, 2, 25735);
    			attr_dev(div64, "class", "relative h-56 overflow-hidden rounded-lg md:h-96");
    			add_location(div64, file, 305, 4, 19578);
    			attr_dev(path3, "stroke", "currentColor");
    			attr_dev(path3, "stroke-linecap", "round");
    			attr_dev(path3, "stroke-linejoin", "round");
    			attr_dev(path3, "stroke-width", "2");
    			attr_dev(path3, "d", "M5 1 1 5l4 4");
    			add_location(path3, file, 373, 16, 26702);
    			attr_dev(svg3, "class", "w-4 h-4 text-white dark:text-gray-800");
    			attr_dev(svg3, "aria-hidden", "true");
    			attr_dev(svg3, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg3, "fill", "none");
    			attr_dev(svg3, "viewBox", "0 0 6 10");
    			add_location(svg3, file, 372, 12, 26549);
    			attr_dev(span18, "class", "sr-only");
    			add_location(span18, file, 375, 12, 26844);
    			attr_dev(span19, "class", "inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/30 dark:bg-gray-800/30 group-hover:bg-white/50 dark:group-hover:bg-gray-800/60 group-focus:ring-4 group-focus:ring-white dark:group-focus:ring-gray-800/70 group-focus:outline-none");
    			add_location(span19, file, 371, 8, 26270);
    			attr_dev(button2, "type", "button");
    			attr_dev(button2, "class", "absolute top-0 left-0 z-30 flex items-center justify-center h-full px-4 cursor-pointer group focus:outline-none");
    			attr_dev(button2, "data-carousel-prev", "");
    			add_location(button2, file, 370, 4, 26100);
    			attr_dev(path4, "stroke", "currentColor");
    			attr_dev(path4, "stroke-linecap", "round");
    			attr_dev(path4, "stroke-linejoin", "round");
    			attr_dev(path4, "stroke-width", "2");
    			attr_dev(path4, "d", "m1 9 4-4-4-4");
    			add_location(path4, file, 381, 16, 27519);
    			attr_dev(svg4, "class", "w-4 h-4 text-white dark:text-gray-800");
    			attr_dev(svg4, "aria-hidden", "true");
    			attr_dev(svg4, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg4, "fill", "none");
    			attr_dev(svg4, "viewBox", "0 0 6 10");
    			add_location(svg4, file, 380, 12, 27366);
    			attr_dev(span20, "class", "sr-only");
    			add_location(span20, file, 383, 12, 27661);
    			attr_dev(span21, "class", "inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/30 dark:bg-gray-800/30 group-hover:bg-white/50 dark:group-hover:bg-gray-800/60 group-focus:ring-4 group-focus:ring-white dark:group-focus:ring-gray-800/70 group-focus:outline-none");
    			add_location(span21, file, 379, 8, 27087);
    			attr_dev(button3, "type", "button");
    			attr_dev(button3, "class", "absolute top-0 right-0 z-30 flex items-center justify-center h-full px-4 cursor-pointer group focus:outline-none");
    			attr_dev(button3, "data-carousel-next", "");
    			add_location(button3, file, 378, 4, 26916);
    			attr_dev(div65, "id", "gallery");
    			attr_dev(div65, "class", "relative w-10/12");
    			attr_dev(div65, "style", "rotate: -3.5deg ; margin-top : 15px ; margin-bottom : 40px");
    			attr_dev(div65, "data-carousel", "slide");
    			add_location(div65, file, 303, 8, 19409);
    			add_location(center, file, 303, 0, 19401);
    			if (!src_url_equal(img45.src, img45_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img45, "src", img45_src_value);
    			attr_dev(img45, "class", "h-16 mr-3");
    			attr_dev(img45, "alt", "Logo");
    			add_location(img45, file, 397, 7, 28041);
    			attr_dev(a26, "href", "/");
    			attr_dev(a26, "class", "flex items-center");
    			add_location(a26, file, 396, 6, 27995);
    			attr_dev(div66, "class", "mb-6 md:mb-0");
    			add_location(div66, file, 395, 6, 27962);
    			attr_dev(h21, "class", "mb-6 text-sm font-semibold text-gray-900 uppercase dark:text-white");
    			add_location(h21, file, 402, 6, 28234);
    			attr_dev(a27, "href", "#bas");
    			attr_dev(a27, "class", "hover:underline");
    			add_location(a27, file, 405, 8, 28425);
    			attr_dev(li5, "class", "mb-4");
    			add_location(li5, file, 404, 7, 28399);
    			attr_dev(a28, "href", "#tutorial");
    			attr_dev(a28, "class", "hover:underline");
    			add_location(a28, file, 408, 8, 28507);
    			add_location(li6, file, 407, 7, 28494);
    			attr_dev(ul1, "class", "text-gray-500 dark:text-gray-200 font-medium");
    			add_location(ul1, file, 403, 6, 28334);
    			attr_dev(div67, "class", "mr-12");
    			add_location(div67, file, 401, 5, 28208);
    			attr_dev(h22, "class", "mb-6 text-sm font-semibold text-gray-900 uppercase dark:text-white");
    			add_location(h22, file, 413, 6, 28621);
    			attr_dev(a29, "href", "https://discord.gg/barbaros");
    			attr_dev(a29, "class", "hover:underline ");
    			add_location(a29, file, 416, 8, 28812);
    			attr_dev(li7, "class", "mb-4");
    			add_location(li7, file, 415, 7, 28786);
    			attr_dev(a30, "href", "https://www.youtube.com/@BARBAROSRP");
    			attr_dev(a30, "class", "hover:underline");
    			add_location(a30, file, 419, 8, 28920);
    			add_location(li8, file, 418, 7, 28907);
    			attr_dev(ul2, "class", "text-gray-500 dark:text-gray-200 font-medium");
    			add_location(ul2, file, 414, 6, 28721);
    			add_location(div68, file, 412, 5, 28609);
    			attr_dev(div69, "class", "grid grid-cols-2 gap-8 sm:gap-6 sm:grid-cols-2");
    			add_location(div69, file, 400, 4, 28142);
    			attr_dev(div70, "class", "md:flex md:justify-between");
    			add_location(div70, file, 394, 3, 27915);
    			attr_dev(hr, "class", "my-6 border-gray-200 sm:mx-auto lg:my-8");
    			add_location(hr, file, 425, 2, 29060);
    			attr_dev(a31, "href", "https://discord.gg/barbaros");
    			attr_dev(a31, "class", "hover:underline font-bold");
    			add_location(a31, file, 427, 54, 29228);
    			attr_dev(a32, "href", "/");
    			attr_dev(a32, "class", "font-bold");
    			add_location(a32, file, 427, 157, 29331);
    			attr_dev(a33, "href", "/");
    			attr_dev(a33, "class", "font-bold");
    			add_location(a33, file, 427, 205, 29379);
    			attr_dev(span22, "class", "text-sm text-gray-200 sm:text-center");
    			add_location(span22, file, 427, 3, 29177);
    			attr_dev(div71, "class", "sm:flex sm:items-center sm:justify-between");
    			add_location(div71, file, 426, 2, 29117);
    			attr_dev(div72, "class", "mx-auto w-full max-w-screen-xl p-4 py-6 lg:py-8");
    			add_location(div72, file, 393, 2, 27850);
    			attr_dev(footer, "class", "pt-20");
    			add_location(footer, file, 392, 1, 27825);
    			attr_dev(section7, "class", "bg-[url('/assets/img/footer-bg.webp')] bg-cover bg-no-repeat");
    			add_location(section7, file, 391, 0, 27745);
    			attr_dev(path5, "d", "M0 0h24v24H0z");
    			set_style(path5, "fill", "none");
    			add_location(path5, file, 437, 267, 30087);
    			attr_dev(path6, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path6, "fill", "none");
    			set_style(path6, "fill-rule", "nonzero");
    			set_style(path6, "stroke", "rgb(0, 0, 0)");
    			set_style(path6, "stroke-width", "2px");
    			add_location(path6, file, 437, 318, 30138);
    			attr_dev(svg5, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg5, "viewBox", "0 0 24 24");
    			attr_dev(svg5, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg5, "xml:space", "preserve");
    			attr_dev(svg5, "fill", "#000000");
    			set_style(svg5, "fill-rule", "evenodd");
    			set_style(svg5, "clip-rule", "evenodd");
    			set_style(svg5, "stroke-linecap", "round");
    			set_style(svg5, "stroke-linejoin", "round");
    			set_style(svg5, "stroke-miterlimit", "2");
    			set_style(svg5, "filter", "invert(1)");
    			add_location(svg5, file, 437, 3, 29823);
    			add_location(button4, file, 436, 2, 29786);
    			attr_dev(p46, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p46, file, 439, 2, 30278);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file, 440, 2, 30350);
    			attr_dev(p47, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p47, file, 441, 2, 30462);
    			attr_dev(a34, "href", "fivem://connect/brrp.online");
    			attr_dev(a34, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a34, file, 442, 2, 30517);
    			attr_dev(div73, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div73, file, 435, 1, 29714);
    			attr_dev(section8, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section8, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section8, "z-index", "1000");
    			set_style(section8, "backdrop-filter", "blur(10px)");
    			set_style(section8, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section8, "display", "none");
    			attr_dev(section8, "id", "connect-overlay");
    			add_location(section8, file, 434, 0, 29479);
    			add_location(main, file, 34, 0, 1169);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, div9);
    			append_dev(div9, nav);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img0);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span0);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul0);
    			append_dev(ul0, li0);
    			append_dev(li0, a1);
    			append_dev(ul0, t7);
    			append_dev(ul0, li1);
    			append_dev(li1, a2);
    			append_dev(ul0, t9);
    			append_dev(ul0, li2);
    			append_dev(li2, a3);
    			append_dev(ul0, t11);
    			append_dev(ul0, li3);
    			append_dev(li3, a4);
    			append_dev(ul0, t13);
    			append_dev(ul0, li4);
    			append_dev(li4, a5);
    			append_dev(div9, t15);
    			append_dev(div9, section0);
    			append_dev(section0, div6);
    			append_dev(div6, div4);
    			append_dev(div4, h20);
    			append_dev(h20, t16);
    			append_dev(h20, div3);
    			append_dev(h20, span1);
    			append_dev(h20, t18);
    			append_dev(div6, t19);
    			append_dev(div6, img1);
    			append_dev(div6, t20);
    			append_dev(div6, div5);
    			append_dev(div5, p0);
    			append_dev(p0, svg1);
    			append_dev(svg1, path1);
    			append_dev(p0, t21);
    			append_dev(p0, span2);
    			append_dev(div5, t23);
    			append_dev(div5, p1);
    			append_dev(p1, span3);
    			append_dev(p1, t25);
    			append_dev(div9, t26);
    			append_dev(div9, div8);
    			append_dev(div8, img2);
    			append_dev(div8, t27);
    			append_dev(div8, img3);
    			append_dev(div8, t28);
    			append_dev(div8, div7);
    			append_dev(div7, svg2);
    			append_dev(svg2, path2);
    			append_dev(main, t29);
    			append_dev(main, section1);
    			append_dev(section1, div15);
    			append_dev(div15, div13);
    			append_dev(div13, p2);
    			append_dev(p2, t30);
    			append_dev(p2, span4);
    			append_dev(div13, t32);
    			append_dev(div13, div12);
    			append_dev(div12, iframe);
    			append_dev(div12, div11);
    			append_dev(div11, div10);
    			append_dev(div10, t33);
    			append_dev(div10, a6);
    			append_dev(div10, t35);
    			append_dev(div11, script);
    			append_dev(div12, style);
    			append_dev(div13, br);
    			append_dev(div15, t37);
    			append_dev(div15, div14);
    			append_dev(div14, img4);
    			append_dev(section1, t38);
    			append_dev(section1, div16);
    			append_dev(div16, p3);
    			append_dev(div16, t40);
    			append_dev(div16, p4);
    			append_dev(p4, span5);
    			append_dev(p4, t42);
    			append_dev(div16, t43);
    			append_dev(div16, p5);
    			append_dev(main, t45);
    			append_dev(main, section2);
    			append_dev(section2, div17);
    			append_dev(div17, img5);
    			append_dev(div17, t46);
    			append_dev(div17, img6);
    			append_dev(div17, t47);
    			append_dev(div17, a7);
    			append_dev(a7, img7);
    			append_dev(main, t48);
    			append_dev(main, section3);
    			append_dev(section3, div24);
    			append_dev(div24, p6);
    			append_dev(div24, t50);
    			append_dev(div24, div20);
    			append_dev(div20, a8);
    			append_dev(a8, div18);
    			append_dev(div18, img8);
    			append_dev(div18, t51);
    			append_dev(div18, p7);
    			append_dev(div18, t53);
    			append_dev(div18, p8);
    			append_dev(div20, t55);
    			append_dev(div20, a9);
    			append_dev(a9, div19);
    			append_dev(div19, img9);
    			append_dev(div19, t56);
    			append_dev(div19, p9);
    			append_dev(div19, t58);
    			append_dev(div19, p10);
    			append_dev(div24, t60);
    			append_dev(div24, div23);
    			append_dev(div23, a10);
    			append_dev(a10, div21);
    			append_dev(div21, img10);
    			append_dev(div21, t61);
    			append_dev(div21, p11);
    			append_dev(div21, t63);
    			append_dev(div21, p12);
    			append_dev(div23, t65);
    			append_dev(div23, a11);
    			append_dev(a11, div22);
    			append_dev(div22, img11);
    			append_dev(div22, t66);
    			append_dev(div22, p13);
    			append_dev(div22, t68);
    			append_dev(div22, p14);
    			append_dev(div24, t70);
    			append_dev(div24, p15);
    			append_dev(div24, t72);
    			append_dev(div24, p16);
    			append_dev(main, t74);
    			append_dev(main, section4);
    			append_dev(section4, div40);
    			append_dev(div40, a12);
    			append_dev(div40, t75);
    			append_dev(div40, p17);
    			append_dev(div40, t77);
    			append_dev(div40, div27);
    			append_dev(div27, a13);
    			append_dev(a13, div25);
    			append_dev(div25, img12);
    			append_dev(div25, t78);
    			append_dev(div25, p18);
    			append_dev(div25, t80);
    			append_dev(div25, p19);
    			append_dev(p19, t81);
    			append_dev(p19, span6);
    			append_dev(p19, t83);
    			append_dev(div27, t84);
    			append_dev(div27, a14);
    			append_dev(a14, div26);
    			append_dev(div26, img13);
    			append_dev(div26, t85);
    			append_dev(div26, p20);
    			append_dev(div26, t87);
    			append_dev(div26, p21);
    			append_dev(p21, t88);
    			append_dev(p21, span7);
    			append_dev(p21, t90);
    			append_dev(div40, t91);
    			append_dev(div40, div30);
    			append_dev(div30, a15);
    			append_dev(a15, div28);
    			append_dev(div28, img14);
    			append_dev(div28, t92);
    			append_dev(div28, p22);
    			append_dev(div28, t94);
    			append_dev(div28, p23);
    			append_dev(p23, t95);
    			append_dev(p23, span8);
    			append_dev(p23, t97);
    			append_dev(div30, t98);
    			append_dev(div30, a16);
    			append_dev(a16, div29);
    			append_dev(div29, img15);
    			append_dev(div29, t99);
    			append_dev(div29, p24);
    			append_dev(div29, t101);
    			append_dev(div29, p25);
    			append_dev(p25, t102);
    			append_dev(p25, span9);
    			append_dev(p25, t104);
    			append_dev(div40, t105);
    			append_dev(div40, div33);
    			append_dev(div33, a17);
    			append_dev(a17, div31);
    			append_dev(div31, img16);
    			append_dev(div31, t106);
    			append_dev(div31, p26);
    			append_dev(div31, t108);
    			append_dev(div31, p27);
    			append_dev(p27, t109);
    			append_dev(p27, span10);
    			append_dev(p27, t111);
    			append_dev(div33, t112);
    			append_dev(div33, a18);
    			append_dev(a18, div32);
    			append_dev(div32, img17);
    			append_dev(div32, t113);
    			append_dev(div32, p28);
    			append_dev(div32, t115);
    			append_dev(div32, p29);
    			append_dev(p29, t116);
    			append_dev(p29, span11);
    			append_dev(p29, t118);
    			append_dev(div40, t119);
    			append_dev(div40, div36);
    			append_dev(div36, a19);
    			append_dev(a19, div34);
    			append_dev(div34, img18);
    			append_dev(div34, t120);
    			append_dev(div34, p30);
    			append_dev(div34, t122);
    			append_dev(div34, p31);
    			append_dev(p31, t123);
    			append_dev(p31, span12);
    			append_dev(p31, t125);
    			append_dev(div36, t126);
    			append_dev(div36, a20);
    			append_dev(a20, div35);
    			append_dev(div35, img19);
    			append_dev(div35, t127);
    			append_dev(div35, p32);
    			append_dev(div35, t129);
    			append_dev(div35, p33);
    			append_dev(p33, t130);
    			append_dev(p33, span13);
    			append_dev(p33, t132);
    			append_dev(div40, t133);
    			append_dev(div40, div39);
    			append_dev(div39, a21);
    			append_dev(a21, div37);
    			append_dev(div37, img20);
    			append_dev(div37, t134);
    			append_dev(div37, p34);
    			append_dev(div37, t136);
    			append_dev(div37, p35);
    			append_dev(p35, t137);
    			append_dev(p35, span14);
    			append_dev(p35, t139);
    			append_dev(div39, t140);
    			append_dev(div39, a22);
    			append_dev(a22, div38);
    			append_dev(div38, img21);
    			append_dev(div38, t141);
    			append_dev(div38, p36);
    			append_dev(div38, t143);
    			append_dev(div38, p37);
    			append_dev(p37, t144);
    			append_dev(p37, span15);
    			append_dev(p37, t146);
    			append_dev(div40, t147);
    			append_dev(div40, p38);
    			append_dev(div40, t149);
    			append_dev(div40, p39);
    			append_dev(main, t151);
    			append_dev(main, section5);
    			append_dev(section5, p40);
    			append_dev(p40, t152);
    			append_dev(p40, span16);
    			append_dev(p40, t154);
    			append_dev(section5, t155);
    			append_dev(section5, div44);
    			append_dev(div44, div41);
    			append_dev(div41, a23);
    			append_dev(a23, img22);
    			append_dev(div41, t156);
    			append_dev(div41, p41);
    			append_dev(div44, t158);
    			append_dev(div44, div42);
    			append_dev(div42, a24);
    			append_dev(a24, img23);
    			append_dev(div42, t159);
    			append_dev(div42, p42);
    			append_dev(div44, t161);
    			append_dev(div44, div43);
    			append_dev(div43, a25);
    			append_dev(a25, img24);
    			append_dev(div43, t162);
    			append_dev(div43, p43);
    			append_dev(main, t164);
    			append_dev(main, section6);
    			append_dev(section6, img25);
    			append_dev(section6, t165);
    			append_dev(section6, p44);
    			append_dev(p44, t166);
    			append_dev(p44, span17);
    			append_dev(p44, t168);
    			append_dev(section6, t169);
    			append_dev(section6, p45);
    			append_dev(main, t171);
    			append_dev(main, center);
    			append_dev(center, div65);
    			append_dev(div65, div64);
    			append_dev(div64, div45);
    			append_dev(div45, img26);
    			append_dev(div64, t172);
    			append_dev(div64, div46);
    			append_dev(div46, img27);
    			append_dev(div64, t173);
    			append_dev(div64, div47);
    			append_dev(div47, img28);
    			append_dev(div64, t174);
    			append_dev(div64, div48);
    			append_dev(div48, img29);
    			append_dev(div64, t175);
    			append_dev(div64, div49);
    			append_dev(div49, img30);
    			append_dev(div64, t176);
    			append_dev(div64, div50);
    			append_dev(div50, img31);
    			append_dev(div64, t177);
    			append_dev(div64, div51);
    			append_dev(div51, img32);
    			append_dev(div64, t178);
    			append_dev(div64, div52);
    			append_dev(div52, img33);
    			append_dev(div64, t179);
    			append_dev(div64, div53);
    			append_dev(div53, img34);
    			append_dev(div64, t180);
    			append_dev(div64, div54);
    			append_dev(div54, img35);
    			append_dev(div64, t181);
    			append_dev(div64, div55);
    			append_dev(div55, img36);
    			append_dev(div64, t182);
    			append_dev(div64, div56);
    			append_dev(div56, img37);
    			append_dev(div64, t183);
    			append_dev(div64, div57);
    			append_dev(div57, img38);
    			append_dev(div64, t184);
    			append_dev(div64, div58);
    			append_dev(div58, img39);
    			append_dev(div64, t185);
    			append_dev(div64, div59);
    			append_dev(div59, img40);
    			append_dev(div64, t186);
    			append_dev(div64, div60);
    			append_dev(div60, img41);
    			append_dev(div64, t187);
    			append_dev(div64, div61);
    			append_dev(div61, img42);
    			append_dev(div64, t188);
    			append_dev(div64, div62);
    			append_dev(div62, img43);
    			append_dev(div64, t189);
    			append_dev(div64, div63);
    			append_dev(div63, img44);
    			append_dev(div65, t190);
    			append_dev(div65, button2);
    			append_dev(button2, span19);
    			append_dev(span19, svg3);
    			append_dev(svg3, path3);
    			append_dev(span19, t191);
    			append_dev(span19, span18);
    			append_dev(div65, t193);
    			append_dev(div65, button3);
    			append_dev(button3, span21);
    			append_dev(span21, svg4);
    			append_dev(svg4, path4);
    			append_dev(span21, t194);
    			append_dev(span21, span20);
    			append_dev(main, t196);
    			append_dev(main, section7);
    			append_dev(section7, footer);
    			append_dev(footer, div72);
    			append_dev(div72, div70);
    			append_dev(div70, div66);
    			append_dev(div66, a26);
    			append_dev(a26, img45);
    			append_dev(div70, t197);
    			append_dev(div70, div69);
    			append_dev(div69, div67);
    			append_dev(div67, h21);
    			append_dev(div67, t199);
    			append_dev(div67, ul1);
    			append_dev(ul1, li5);
    			append_dev(li5, a27);
    			append_dev(ul1, t201);
    			append_dev(ul1, li6);
    			append_dev(li6, a28);
    			append_dev(div69, t203);
    			append_dev(div69, div68);
    			append_dev(div68, h22);
    			append_dev(div68, t205);
    			append_dev(div68, ul2);
    			append_dev(ul2, li7);
    			append_dev(li7, a29);
    			append_dev(ul2, t207);
    			append_dev(ul2, li8);
    			append_dev(li8, a30);
    			append_dev(div72, t209);
    			append_dev(div72, hr);
    			append_dev(div72, t210);
    			append_dev(div72, div71);
    			append_dev(div71, span22);
    			append_dev(span22, a31);
    			append_dev(span22, t212);
    			append_dev(span22, a32);
    			append_dev(span22, t214);
    			append_dev(span22, a33);
    			append_dev(span22, t216);
    			append_dev(main, t217);
    			append_dev(main, section8);
    			append_dev(section8, div73);
    			append_dev(div73, button4);
    			append_dev(button4, svg5);
    			append_dev(svg5, path5);
    			append_dev(svg5, path6);
    			append_dev(div73, t218);
    			append_dev(div73, p46);
    			append_dev(div73, t220);
    			append_dev(div73, input);
    			append_dev(div73, t221);
    			append_dev(div73, p47);
    			append_dev(div73, t223);
    			append_dev(div73, a34);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay, false, false, false, false),
    					listen_dev(button4, "click", close_overlay, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Home', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Home> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay, close_overlay });
    	return [];
    }

    class Home extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Home",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    /* src\routes\Rules.svelte generated by Svelte v3.59.2 */

    const file$1 = "src\\routes\\Rules.svelte";

    function create_fragment$2(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$1, 38, 4, 1781);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$1, 37, 2, 1738);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$1, 41, 4, 1913);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$1, 43, 4, 2511);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$1, 45, 6, 2673);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$1, 44, 4, 2559);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$1, 42, 4, 2159);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$1, 40, 2, 1879);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$1, 53, 4, 3102);
    			add_location(li0, file$1, 51, 4, 3043);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$1, 56, 4, 3194);
    			add_location(li1, file$1, 55, 4, 3185);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$1, 59, 8, 3315);
    			add_location(li2, file$1, 58, 6, 3302);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$1, 62, 4, 3420);
    			add_location(li3, file$1, 61, 4, 3411);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$1, 50, 2, 2932);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$1, 49, 2, 2828);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$1, 36, 2, 1650);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$1, 35, 0, 1575);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/general-rules.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$1, 69, 0, 3562);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$1, 73, 267, 4323);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$1, 73, 318, 4374);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$1, 73, 3, 4059);
    			add_location(button2, file$1, 72, 2, 4022);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$1, 75, 2, 4514);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$1, 76, 2, 4586);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$1, 77, 2, 4698);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$1, 78, 2, 4753);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$1, 71, 1, 3950);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$1, 70, 0, 3715);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$1, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$1, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$1() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$1() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Rules', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Rules> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$1, close_overlay: close_overlay$1 });
    	return [];
    }

    class Rules extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Rules",
    			options,
    			id: create_fragment$2.name
    		});
    	}
    }

    /* src\routes\Mobile.svelte generated by Svelte v3.59.2 */

    const file$2 = "src\\routes\\Mobile.svelte";

    function create_fragment$3(ctx) {
    	let main;
    	let div;
    	let img;
    	let img_src_value;
    	let t0;
    	let a0;
    	let t2;
    	let a1;
    	let t4;
    	let p0;
    	let t6;
    	let p1;

    	const block = {
    		c: function create() {
    			main = element("main");
    			div = element("div");
    			img = element("img");
    			t0 = space();
    			a0 = element("a");
    			a0.textContent = "Server Rules";
    			t2 = space();
    			a1 = element("a");
    			a1.textContent = "Join Discord";
    			t4 = space();
    			p0 = element("p");
    			p0.textContent = "Server IP: brrp.online";
    			t6 = space();
    			p1 = element("p");
    			p1.textContent = "Open this website on a desktop for a better experience.";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$2, 25, 8, 939);
    			attr_dev(a0, "href", "/#/rules");
    			attr_dev(a0, "class", "text-white font-semibold mt-2 text-xl");
    			add_location(a0, file$2, 26, 8, 1026);
    			attr_dev(a1, "href", "https://discord.gg/barbaros");
    			attr_dev(a1, "class", "text-white font-semibold mt-2 text-xl");
    			add_location(a1, file$2, 27, 8, 1116);
    			attr_dev(p0, "class", "text-white mt-4");
    			add_location(p0, file$2, 28, 8, 1225);
    			attr_dev(p1, "class", "text-red-500 text-center mt-2 w-3/4");
    			add_location(p1, file$2, 29, 8, 1287);
    			attr_dev(div, "class", "flex flex-col items-center justify-center h-screen");
    			add_location(div, file$2, 24, 4, 866);
    			attr_dev(main, "class", "bg-black w-full m-0");
    			add_location(main, file$2, 23, 0, 827);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, div);
    			append_dev(div, img);
    			append_dev(div, t0);
    			append_dev(div, a0);
    			append_dev(div, t2);
    			append_dev(div, a1);
    			append_dev(div, t4);
    			append_dev(div, p0);
    			append_dev(div, t6);
    			append_dev(div, p1);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function redirectToURLIfScreenSmallOrMobile() {
    	// Get the current width and height of the screen
    	var screenWidth = window.innerWidth;

    	var screenHeight = window.innerHeight;

    	// Check if the screen size is smaller than 1280x720
    	// or if the user agent indicates a mobile device
    	if (screenWidth > 1280 || screenHeight > 720 || !isMobileDevice()) {
    		// Redirect to your desired URL
    		window.location.href = "/";
    	}
    }

    // Function to check if the user agent indicates a mobile device
    function isMobileDevice() {
    	return (/Mobi|Android/i).test(navigator.userAgent);
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Mobile', slots, []);
    	window.onload = redirectToURLIfScreenSmallOrMobile;
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Mobile> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		redirectToURLIfScreenSmallOrMobile,
    		isMobileDevice
    	});

    	return [];
    }

    class Mobile extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Mobile",
    			options,
    			id: create_fragment$3.name
    		});
    	}
    }

    /* src\routes\NotFound.svelte generated by Svelte v3.59.2 */

    const file$3 = "src\\routes\\NotFound.svelte";

    function create_fragment$4(ctx) {
    	let h1;
    	let t1;
    	let p;

    	const block = {
    		c: function create() {
    			h1 = element("h1");
    			h1.textContent = "Not Found";
    			t1 = space();
    			p = element("p");
    			p.textContent = "This route doesn't exist.";
    			attr_dev(h1, "class", "svelte-r5e5ng");
    			add_location(h1, file$3, 0, 0, 0);
    			add_location(p, file$3, 1, 0, 19);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, h1, anchor);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(h1);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$4($$self, $$props) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('NotFound', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<NotFound> was created with unknown prop '${key}'`);
    	});

    	return [];
    }

    class NotFound extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "NotFound",
    			options,
    			id: create_fragment$4.name
    		});
    	}
    }

    /* src\routes\Police.svelte generated by Svelte v3.59.2 */

    const file$4 = "src\\routes\\Police.svelte";

    function create_fragment$5(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$4, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$4, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$4, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$4, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$4, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$4, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$4, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$4, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$4, 31, 4, 1871);
    			add_location(li0, file$4, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$4, 34, 4, 1966);
    			add_location(li1, file$4, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$4, 37, 8, 2090);
    			add_location(li2, file$4, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$4, 40, 4, 2198);
    			add_location(li3, file$4, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$4, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$4, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$4, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$4, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/police-rules.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$4, 46, 0, 2345);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$4, 50, 267, 3109);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$4, 50, 318, 3160);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$4, 50, 3, 2845);
    			add_location(button2, file$4, 49, 2, 2807);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$4, 52, 2, 3302);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$4, 53, 2, 3375);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$4, 54, 2, 3488);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$4, 55, 2, 3544);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$4, 48, 1, 2734);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$4, 47, 0, 2498);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$2, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$2, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$5.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$2() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$2() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Police', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Police> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$2, close_overlay: close_overlay$2 });
    	return [];
    }

    class Police extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$5, create_fragment$5, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Police",
    			options,
    			id: create_fragment$5.name
    		});
    	}
    }

    /* src\routes\Illegal.svelte generated by Svelte v3.59.2 */

    const file$5 = "src\\routes\\Illegal.svelte";

    function create_fragment$6(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$5, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$5, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$5, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$5, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$5, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$5, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$5, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$5, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$5, 31, 4, 1871);
    			add_location(li0, file$5, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$5, 34, 4, 1966);
    			add_location(li1, file$5, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$5, 37, 8, 2090);
    			add_location(li2, file$5, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$5, 40, 4, 2198);
    			add_location(li3, file$5, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$5, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$5, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$5, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$5, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/illegal-rules.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$5, 46, 0, 2345);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$5, 50, 267, 3110);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$5, 50, 318, 3161);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$5, 50, 3, 2846);
    			add_location(button2, file$5, 49, 2, 2808);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$5, 52, 2, 3303);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$5, 53, 2, 3376);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$5, 54, 2, 3489);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$5, 55, 2, 3545);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$5, 48, 1, 2735);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$5, 47, 0, 2499);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$3, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$3, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$6.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$3() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$3() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$6($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Illegal', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Illegal> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$3, close_overlay: close_overlay$3 });
    	return [];
    }

    class Illegal extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$6, create_fragment$6, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Illegal",
    			options,
    			id: create_fragment$6.name
    		});
    	}
    }

    /* src\routes\Gangwar.svelte generated by Svelte v3.59.2 */

    const file$6 = "src\\routes\\Gangwar.svelte";

    function create_fragment$7(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$6, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$6, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$6, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$6, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$6, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$6, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$6, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$6, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$6, 31, 4, 1871);
    			add_location(li0, file$6, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$6, 34, 4, 1966);
    			add_location(li1, file$6, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$6, 37, 8, 2090);
    			add_location(li2, file$6, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$6, 40, 4, 2198);
    			add_location(li3, file$6, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$6, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$6, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$6, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$6, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/gang-war-rules.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$6, 46, 0, 2345);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$6, 50, 267, 3111);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$6, 50, 318, 3162);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$6, 50, 3, 2847);
    			add_location(button2, file$6, 49, 2, 2809);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$6, 52, 2, 3304);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$6, 53, 2, 3377);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$6, 54, 2, 3490);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$6, 55, 2, 3546);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$6, 48, 1, 2736);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$6, 47, 0, 2500);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$4, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$4, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$7.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$4() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$4() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$7($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Gangwar', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Gangwar> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$4, close_overlay: close_overlay$4 });
    	return [];
    }

    class Gangwar extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$7, create_fragment$7, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Gangwar",
    			options,
    			id: create_fragment$7.name
    		});
    	}
    }

    /* src\routes\Robguide.svelte generated by Svelte v3.59.2 */

    const file$7 = "src\\routes\\Robguide.svelte";

    function create_fragment$8(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img0;
    	let img0_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span0;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let section0;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t12;
    	let p0;
    	let t14;
    	let input;
    	let t15;
    	let p1;
    	let t17;
    	let a4;
    	let t19;
    	let section1;
    	let img1;
    	let img1_src_value;
    	let t20;
    	let p2;
    	let span1;
    	let t22;
    	let t23;
    	let p3;
    	let t25;
    	let section2;
    	let div10;
    	let div6;
    	let iframe0;
    	let iframe0_src_value;
    	let div5;
    	let div4;
    	let t26;
    	let a5;
    	let t28;
    	let script0;
    	let script0_src_value;
    	let style0;
    	let br0;
    	let t30;
    	let div9;
    	let iframe1;
    	let iframe1_src_value;
    	let div8;
    	let div7;
    	let t31;
    	let a6;
    	let t33;
    	let script1;
    	let script1_src_value;
    	let style1;
    	let br1;
    	let t35;
    	let div17;
    	let div13;
    	let iframe2;
    	let iframe2_src_value;
    	let div12;
    	let div11;
    	let t36;
    	let a7;
    	let t38;
    	let script2;
    	let script2_src_value;
    	let style2;
    	let br2;
    	let t40;
    	let div16;
    	let iframe3;
    	let iframe3_src_value;
    	let div15;
    	let div14;
    	let t41;
    	let a8;
    	let t43;
    	let script3;
    	let script3_src_value;
    	let style3;
    	let br3;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img0 = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span0 = element("span");
    			span0.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Mini Game";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Discord";
    			t11 = space();
    			section0 = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t12 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t14 = space();
    			input = element("input");
    			t15 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t17 = space();
    			a4 = element("a");
    			a4.textContent = "OPEN FIVEM";
    			t19 = space();
    			section1 = element("section");
    			img1 = element("img");
    			t20 = space();
    			p2 = element("p");
    			span1 = element("span");
    			span1.textContent = "Heists";
    			t22 = text(" System!");
    			t23 = space();
    			p3 = element("p");
    			p3.textContent = "Engage in the thrilling world of illegal activities with Barbaros RolePlay system. Participate in car boosting, daring thermite missions, and bank truck heists, culminating in a daring infiltration of the notorious human labs. Unleash your criminal prowess in this immersive roleplay experience.";
    			t25 = space();
    			section2 = element("section");
    			div10 = element("div");
    			div6 = element("div");
    			iframe0 = element("iframe");
    			div5 = element("div");
    			div4 = element("div");
    			t26 = text("Generated by ");
    			a5 = element("a");
    			a5.textContent = "Embed Youtube Video";
    			t28 = text(" online");
    			script0 = element("script");
    			style0 = element("style");
    			style0.textContent = ".newst{position:relative;text-align:right;height:420px;width:520px;} #gmap_canvas img{max-width:none!important;background:none!important}";
    			br0 = element("br");
    			t30 = space();
    			div9 = element("div");
    			iframe1 = element("iframe");
    			div8 = element("div");
    			div7 = element("div");
    			t31 = text("Generated by ");
    			a6 = element("a");
    			a6.textContent = "Embed Youtube Video";
    			t33 = text(" online");
    			script1 = element("script");
    			style1 = element("style");
    			style1.textContent = ".newst{position:relative;text-align:right;height:420px;width:520px;} #gmap_canvas img{max-width:none!important;background:none!important}";
    			br1 = element("br");
    			t35 = space();
    			div17 = element("div");
    			div13 = element("div");
    			iframe2 = element("iframe");
    			div12 = element("div");
    			div11 = element("div");
    			t36 = text("Generated by ");
    			a7 = element("a");
    			a7.textContent = "Embed Youtube Video";
    			t38 = text(" online");
    			script2 = element("script");
    			style2 = element("style");
    			style2.textContent = ".newst{position:relative;text-align:right;height:420px;width:520px;} #gmap_canvas img{max-width:none!important;background:none!important}";
    			br2 = element("br");
    			t40 = space();
    			div16 = element("div");
    			iframe3 = element("iframe");
    			div15 = element("div");
    			div14 = element("div");
    			t41 = text("Generated by ");
    			a8 = element("a");
    			a8.textContent = "Embed Youtube Video";
    			t43 = text(" online");
    			script3 = element("script");
    			style3 = element("style");
    			style3.textContent = ".newst{position:relative;text-align:right;height:420px;width:520px;} #gmap_canvas img{max-width:none!important;background:none!important}";
    			br3 = element("br");
    			if (!src_url_equal(img0.src, img0_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img0, "src", img0_src_value);
    			attr_dev(img0, "class", "h-14 mr-3 mt-1");
    			attr_dev(img0, "alt", "Barbaros Logo");
    			add_location(img0, file$7, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$7, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$7, 19, 4, 670);
    			attr_dev(span0, "class", "sr-only");
    			add_location(span0, file$7, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$7, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$7, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$7, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$7, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$7, 31, 4, 1871);
    			add_location(li0, file$7, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/mini");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$7, 34, 6, 1968);
    			add_location(li1, file$7, 33, 4, 1956);
    			attr_dev(a3, "href", "https://discord.gg/barbaros");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$7, 37, 4, 2074);
    			add_location(li2, file$7, 36, 4, 2064);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$7, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$7, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$7, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$7, 13, 0, 326);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$7, 49, 267, 2993);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$7, 49, 318, 3044);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$7, 49, 3, 2729);
    			add_location(button2, file$7, 48, 2, 2691);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$7, 51, 2, 3186);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$7, 52, 2, 3259);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$7, 53, 2, 3372);
    			attr_dev(a4, "href", "fivem://connect/brrp.online");
    			attr_dev(a4, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a4, file$7, 54, 2, 3428);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$7, 47, 1, 2618);
    			attr_dev(section0, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section0, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section0, "z-index", "1000");
    			set_style(section0, "backdrop-filter", "blur(10px)");
    			set_style(section0, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section0, "display", "none");
    			attr_dev(section0, "id", "connect-overlay");
    			add_location(section0, file$7, 46, 0, 2382);
    			if (!src_url_equal(img1.src, img1_src_value = "/assets/img/left-fly-community.png")) attr_dev(img1, "src", img1_src_value);
    			attr_dev(img1, "alt", "Object");
    			attr_dev(img1, "class", "absolute right-0");
    			add_location(img1, file$7, 58, 1, 3746);
    			attr_dev(span1, "class", "text-[#7C5BF1]");
    			add_location(span1, file$7, 59, 46, 3878);
    			attr_dev(p2, "class", "text-5xl font-bold text-[#2F344F]");
    			add_location(p2, file$7, 59, 1, 3833);
    			attr_dev(p3, "class", "text-lg mt-4 text-[#2F344F] text-center w-2/4");
    			add_location(p3, file$7, 60, 1, 3935);
    			attr_dev(section1, "class", "flex flex-col items-center relative mt-8");
    			add_location(section1, file$7, 57, 0, 3685);
    			attr_dev(iframe0, "frameborder", "0");
    			attr_dev(iframe0, "scrolling", "no");
    			attr_dev(iframe0, "marginheight", "0");
    			attr_dev(iframe0, "marginwidth", "0");
    			attr_dev(iframe0, "width", "500");
    			attr_dev(iframe0, "height", "300");
    			attr_dev(iframe0, "type", "text/html");
    			if (!src_url_equal(iframe0.src, iframe0_src_value = "https://www.youtube.com/embed/9hIYmXVi4Xg?autoplay=0&fs=1&iv_load_policy=3&showinfo=0&rel=0&cc_load_policy=0&start=0&end=0&vq=hd1080")) attr_dev(iframe0, "src", iframe0_src_value);
    			add_location(iframe0, file$7, 68, 102, 4784);
    			attr_dev(a5, "href", "https://www.embedista.com/embed-youtube-video");
    			add_location(a5, file$7, 68, 581, 5263);
    			set_style(div4, "overflow", "auto");
    			set_style(div4, "position", "absolute");
    			set_style(div4, "height", "0pt");
    			set_style(div4, "width", "0pt");
    			add_location(div4, file$7, 68, 494, 5176);
    			attr_dev(script0, "type", "text/javascript");
    			if (!src_url_equal(script0.src, script0_src_value = "https://www.embedista.com/j/ytvideo.js")) attr_dev(script0, "src", script0_src_value);
    			add_location(script0, file$7, 68, 673, 5355);
    			set_style(div5, "position", "absolute");
    			set_style(div5, "bottom", "10px");
    			set_style(div5, "left", "0");
    			set_style(div5, "right", "0");
    			set_style(div5, "margin-left", "auto");
    			set_style(div5, "margin-right", "auto");
    			set_style(div5, "color", "#000");
    			set_style(div5, "text-align", "center");
    			add_location(div5, file$7, 68, 363, 5045);
    			add_location(style0, file$7, 68, 764, 5446);
    			attr_dev(div6, "style", "overflow:hidden ; position: relative ; margin-top : 20px ; border-radius : 10px");
    			add_location(div6, file$7, 68, 6, 4688);
    			add_location(br0, file$7, 68, 922, 5604);
    			attr_dev(iframe1, "frameborder", "0");
    			attr_dev(iframe1, "scrolling", "no");
    			attr_dev(iframe1, "marginheight", "0");
    			attr_dev(iframe1, "marginwidth", "0");
    			attr_dev(iframe1, "width", "500");
    			attr_dev(iframe1, "height", "300");
    			attr_dev(iframe1, "type", "text/html");
    			if (!src_url_equal(iframe1.src, iframe1_src_value = "https://www.youtube.com/embed/k6qDOfum5kA?autoplay=0&fs=1&iv_load_policy=3&showinfo=0&rel=0&cc_load_policy=0&start=0&end=0&vq=hd1080")) attr_dev(iframe1, "src", iframe1_src_value);
    			add_location(iframe1, file$7, 70, 100, 5765);
    			attr_dev(a6, "href", "https://www.embedista.com/embed-youtube-video");
    			add_location(a6, file$7, 70, 579, 6244);
    			set_style(div7, "overflow", "auto");
    			set_style(div7, "position", "absolute");
    			set_style(div7, "height", "0pt");
    			set_style(div7, "width", "0pt");
    			add_location(div7, file$7, 70, 492, 6157);
    			attr_dev(script1, "type", "text/javascript");
    			if (!src_url_equal(script1.src, script1_src_value = "https://www.embedista.com/j/ytvideo.js")) attr_dev(script1, "src", script1_src_value);
    			add_location(script1, file$7, 70, 671, 6336);
    			set_style(div8, "position", "absolute");
    			set_style(div8, "bottom", "10px");
    			set_style(div8, "left", "0");
    			set_style(div8, "right", "0");
    			set_style(div8, "margin-left", "auto");
    			set_style(div8, "margin-right", "auto");
    			set_style(div8, "color", "#000");
    			set_style(div8, "text-align", "center");
    			add_location(div8, file$7, 70, 361, 6026);
    			add_location(style1, file$7, 70, 762, 6427);
    			attr_dev(div9, "style", "overflow:hidden ; position: relative ; margin-top : 20px ; border-radius : 10px");
    			add_location(div9, file$7, 70, 6, 5671);
    			add_location(br1, file$7, 70, 920, 6585);
    			attr_dev(div10, "style", "display: flex; justify-content :space-evenly; align-items : center ; flex-wrap : wrap ; ");
    			add_location(div10, file$7, 66, 2, 4525);
    			attr_dev(iframe2, "frameborder", "0");
    			attr_dev(iframe2, "scrolling", "no");
    			attr_dev(iframe2, "marginheight", "0");
    			attr_dev(iframe2, "marginwidth", "0");
    			attr_dev(iframe2, "width", "500");
    			attr_dev(iframe2, "height", "300");
    			attr_dev(iframe2, "type", "text/html");
    			if (!src_url_equal(iframe2.src, iframe2_src_value = "https://www.youtube.com/embed/BTbl3ZjPZYs?autoplay=0&fs=1&iv_load_policy=3&showinfo=0&rel=0&cc_load_policy=0&start=0&end=0&vq=hd1080")) attr_dev(iframe2, "src", iframe2_src_value);
    			add_location(iframe2, file$7, 74, 98, 6858);
    			attr_dev(a7, "href", "https://www.embedista.com/embed-youtube-video");
    			add_location(a7, file$7, 74, 577, 7337);
    			set_style(div11, "overflow", "auto");
    			set_style(div11, "position", "absolute");
    			set_style(div11, "height", "0pt");
    			set_style(div11, "width", "0pt");
    			add_location(div11, file$7, 74, 490, 7250);
    			attr_dev(script2, "type", "text/javascript");
    			if (!src_url_equal(script2.src, script2_src_value = "https://www.embedista.com/j/ytvideo.js")) attr_dev(script2, "src", script2_src_value);
    			add_location(script2, file$7, 74, 669, 7429);
    			set_style(div12, "position", "absolute");
    			set_style(div12, "bottom", "10px");
    			set_style(div12, "left", "0");
    			set_style(div12, "right", "0");
    			set_style(div12, "margin-left", "auto");
    			set_style(div12, "margin-right", "auto");
    			set_style(div12, "color", "#000");
    			set_style(div12, "text-align", "center");
    			add_location(div12, file$7, 74, 359, 7119);
    			add_location(style2, file$7, 74, 760, 7520);
    			attr_dev(div13, "style", "overflow:hidden;position: relative ; border-radius : 10px ; margin-top : 20px; ");
    			add_location(div13, file$7, 74, 4, 6764);
    			add_location(br2, file$7, 74, 918, 7678);
    			attr_dev(iframe3, "frameborder", "0");
    			attr_dev(iframe3, "scrolling", "no");
    			attr_dev(iframe3, "marginheight", "0");
    			attr_dev(iframe3, "marginwidth", "0");
    			attr_dev(iframe3, "width", "500");
    			attr_dev(iframe3, "height", "300");
    			attr_dev(iframe3, "type", "text/html");
    			if (!src_url_equal(iframe3.src, iframe3_src_value = "https://www.youtube.com/embed/tAjYVSeBQ_I?autoplay=0&fs=1&iv_load_policy=3&showinfo=0&rel=0&cc_load_policy=0&start=0&end=0&vq=hd1080")) attr_dev(iframe3, "src", iframe3_src_value);
    			add_location(iframe3, file$7, 76, 97, 7834);
    			attr_dev(a8, "href", "https://www.embedista.com/embed-youtube-video");
    			add_location(a8, file$7, 76, 576, 8313);
    			set_style(div14, "overflow", "auto");
    			set_style(div14, "position", "absolute");
    			set_style(div14, "height", "0pt");
    			set_style(div14, "width", "0pt");
    			add_location(div14, file$7, 76, 489, 8226);
    			attr_dev(script3, "type", "text/javascript");
    			if (!src_url_equal(script3.src, script3_src_value = "https://www.embedista.com/j/ytvideo.js")) attr_dev(script3, "src", script3_src_value);
    			add_location(script3, file$7, 76, 668, 8405);
    			set_style(div15, "position", "absolute");
    			set_style(div15, "bottom", "10px");
    			set_style(div15, "left", "0");
    			set_style(div15, "right", "0");
    			set_style(div15, "margin-left", "auto");
    			set_style(div15, "margin-right", "auto");
    			set_style(div15, "color", "#000");
    			set_style(div15, "text-align", "center");
    			add_location(div15, file$7, 76, 358, 8095);
    			add_location(style3, file$7, 76, 759, 8496);
    			attr_dev(div16, "style", "overflow:hidden; position: relative ; border-radius : 10px ; margin-top : 20px;");
    			add_location(div16, file$7, 76, 4, 7741);
    			add_location(br3, file$7, 76, 917, 8654);
    			attr_dev(div17, "style", "display: flex; justify-content :space-evenly; align-items : center ; flex-wrap : wrap ; ");
    			add_location(div17, file$7, 72, 2, 6605);
    			attr_dev(section2, "class", "bg-cover bg-no-repeat");
    			attr_dev(section2, "style", "background-image : url('/assets/img/bg-main.png') ; margin-top : 20px ;");
    			add_location(section2, file$7, 65, 0, 4401);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img0);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span0);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			insert_dev(target, t11, anchor);
    			insert_dev(target, section0, anchor);
    			append_dev(section0, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t12);
    			append_dev(div3, p0);
    			append_dev(div3, t14);
    			append_dev(div3, input);
    			append_dev(div3, t15);
    			append_dev(div3, p1);
    			append_dev(div3, t17);
    			append_dev(div3, a4);
    			insert_dev(target, t19, anchor);
    			insert_dev(target, section1, anchor);
    			append_dev(section1, img1);
    			append_dev(section1, t20);
    			append_dev(section1, p2);
    			append_dev(p2, span1);
    			append_dev(p2, t22);
    			append_dev(section1, t23);
    			append_dev(section1, p3);
    			insert_dev(target, t25, anchor);
    			insert_dev(target, section2, anchor);
    			append_dev(section2, div10);
    			append_dev(div10, div6);
    			append_dev(div6, iframe0);
    			append_dev(div6, div5);
    			append_dev(div5, div4);
    			append_dev(div4, t26);
    			append_dev(div4, a5);
    			append_dev(div4, t28);
    			append_dev(div5, script0);
    			append_dev(div6, style0);
    			append_dev(div10, br0);
    			append_dev(div10, t30);
    			append_dev(div10, div9);
    			append_dev(div9, iframe1);
    			append_dev(div9, div8);
    			append_dev(div8, div7);
    			append_dev(div7, t31);
    			append_dev(div7, a6);
    			append_dev(div7, t33);
    			append_dev(div8, script1);
    			append_dev(div9, style1);
    			append_dev(div10, br1);
    			append_dev(section2, t35);
    			append_dev(section2, div17);
    			append_dev(div17, div13);
    			append_dev(div13, iframe2);
    			append_dev(div13, div12);
    			append_dev(div12, div11);
    			append_dev(div11, t36);
    			append_dev(div11, a7);
    			append_dev(div11, t38);
    			append_dev(div12, script2);
    			append_dev(div13, style2);
    			append_dev(div17, br2);
    			append_dev(div17, t40);
    			append_dev(div17, div16);
    			append_dev(div16, iframe3);
    			append_dev(div16, div15);
    			append_dev(div15, div14);
    			append_dev(div14, t41);
    			append_dev(div14, a8);
    			append_dev(div14, t43);
    			append_dev(div15, script3);
    			append_dev(div16, style3);
    			append_dev(div17, br3);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$5, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$5, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t11);
    			if (detaching) detach_dev(section0);
    			if (detaching) detach_dev(t19);
    			if (detaching) detach_dev(section1);
    			if (detaching) detach_dev(t25);
    			if (detaching) detach_dev(section2);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$8.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$5() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$5() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$8($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Robguide', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Robguide> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$5, close_overlay: close_overlay$5 });
    	return [];
    }

    class Robguide extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$8, create_fragment$8, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Robguide",
    			options,
    			id: create_fragment$8.name
    		});
    	}
    }

    /* src\routes\Business.svelte generated by Svelte v3.59.2 */

    const file$8 = "src\\routes\\Business.svelte";

    function create_fragment$9(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$8, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$8, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$8, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$8, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$8, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$8, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$8, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$8, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$8, 31, 4, 1871);
    			add_location(li0, file$8, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$8, 34, 4, 1966);
    			add_location(li1, file$8, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$8, 37, 8, 2090);
    			add_location(li2, file$8, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$8, 40, 4, 2198);
    			add_location(li3, file$8, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$8, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$8, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$8, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$8, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/business.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$8, 46, 0, 2345);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$8, 50, 267, 3105);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$8, 50, 318, 3156);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$8, 50, 3, 2841);
    			add_location(button2, file$8, 49, 2, 2803);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$8, 52, 2, 3298);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$8, 53, 2, 3371);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$8, 54, 2, 3484);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$8, 55, 2, 3540);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$8, 48, 1, 2730);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$8, 47, 0, 2494);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$6, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$6, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$9.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$6() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$6() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$9($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Business', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Business> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$6, close_overlay: close_overlay$6 });
    	return [];
    }

    class Business extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$9, create_fragment$9, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Business",
    			options,
    			id: create_fragment$9.name
    		});
    	}
    }

    /* src\routes\Crime.svelte generated by Svelte v3.59.2 */

    const file$9 = "src\\routes\\Crime.svelte";

    function create_fragment$a(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$9, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$9, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$9, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$9, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$9, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$9, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$9, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$9, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$9, 31, 4, 1871);
    			add_location(li0, file$9, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$9, 34, 4, 1966);
    			add_location(li1, file$9, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$9, 37, 8, 2090);
    			add_location(li2, file$9, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$9, 40, 4, 2198);
    			add_location(li3, file$9, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$9, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$9, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$9, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$9, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/crime-rules.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			attr_dev(iframe, "scrolling", "no");
    			attr_dev(iframe, "onload", "resizeIframe(this)");
    			add_location(iframe, file$9, 46, 0, 2345);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$9, 50, 267, 3112);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$9, 50, 318, 3163);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$9, 50, 3, 2848);
    			add_location(button2, file$9, 49, 2, 2810);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$9, 52, 2, 3305);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$9, 53, 2, 3378);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$9, 54, 2, 3491);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$9, 55, 2, 3547);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$9, 48, 1, 2737);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$9, 47, 0, 2501);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$7, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$7, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$a.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$7() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$7() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$a($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Crime', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Crime> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$7, close_overlay: close_overlay$7 });
    	return [];
    }

    class Crime extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$a, create_fragment$a, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Crime",
    			options,
    			id: create_fragment$a.name
    		});
    	}
    }

    /* src\routes\Discord.svelte generated by Svelte v3.59.2 */

    const file$a = "src\\routes\\Discord.svelte";

    function create_fragment$b(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$a, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$a, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$a, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$a, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$a, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$a, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$a, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$a, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$a, 31, 4, 1871);
    			add_location(li0, file$a, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$a, 34, 4, 1966);
    			add_location(li1, file$a, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$a, 37, 8, 2090);
    			add_location(li2, file$a, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$a, 40, 4, 2198);
    			add_location(li3, file$a, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$a, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$a, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$a, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$a, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/discord.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$a, 47, 0, 2347);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$a, 52, 267, 3108);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$a, 52, 318, 3159);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$a, 52, 3, 2844);
    			add_location(button2, file$a, 51, 2, 2806);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$a, 54, 2, 3301);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$a, 55, 2, 3374);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$a, 56, 2, 3487);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$a, 57, 2, 3543);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$a, 50, 1, 2733);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$a, 49, 0, 2497);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$8, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$8, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$b.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$8() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$8() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$b($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Discord', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Discord> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$8, close_overlay: close_overlay$8 });
    	return [];
    }

    class Discord extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$b, create_fragment$b, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Discord",
    			options,
    			id: create_fragment$b.name
    		});
    	}
    }

    /* src\routes\Ems.svelte generated by Svelte v3.59.2 */

    const file$b = "src\\routes\\Ems.svelte";

    function create_fragment$c(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$b, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$b, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$b, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$b, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$b, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$b, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$b, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$b, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$b, 31, 4, 1871);
    			add_location(li0, file$b, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$b, 34, 4, 1966);
    			add_location(li1, file$b, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$b, 37, 8, 2090);
    			add_location(li2, file$b, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$b, 40, 4, 2198);
    			add_location(li3, file$b, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$b, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$b, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$b, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$b, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/ems-rules.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$b, 46, 0, 2345);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$b, 50, 267, 3106);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$b, 50, 318, 3157);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$b, 50, 3, 2842);
    			add_location(button2, file$b, 49, 2, 2804);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$b, 52, 2, 3299);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$b, 53, 2, 3372);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$b, 54, 2, 3485);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$b, 55, 2, 3541);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$b, 48, 1, 2731);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$b, 47, 0, 2495);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$9, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$9, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$c.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$9() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$9() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$c($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Ems', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Ems> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$9, close_overlay: close_overlay$9 });
    	return [];
    }

    class Ems extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$c, create_fragment$c, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Ems",
    			options,
    			id: create_fragment$c.name
    		});
    	}
    }

    /* src\routes\Safe.svelte generated by Svelte v3.59.2 */

    const file$c = "src\\routes\\Safe.svelte";

    function create_fragment$d(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img0;
    	let img0_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let hr;
    	let t14;
    	let section0;
    	let div3;
    	let img1;
    	let img1_src_value;
    	let t15;
    	let img2;
    	let img2_src_value;
    	let t16;
    	let img3;
    	let img3_src_value;
    	let t17;
    	let div4;
    	let img4;
    	let img4_src_value;
    	let t18;
    	let img5;
    	let img5_src_value;
    	let t19;
    	let img6;
    	let img6_src_value;
    	let t20;
    	let div5;
    	let img7;
    	let img7_src_value;
    	let t21;
    	let img8;
    	let img8_src_value;
    	let t22;
    	let img9;
    	let img9_src_value;
    	let t23;
    	let section1;
    	let div6;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t24;
    	let p0;
    	let t26;
    	let input;
    	let t27;
    	let p1;
    	let t29;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img0 = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			hr = element("hr");
    			t14 = space();
    			section0 = element("section");
    			div3 = element("div");
    			img1 = element("img");
    			t15 = space();
    			img2 = element("img");
    			t16 = space();
    			img3 = element("img");
    			t17 = space();
    			div4 = element("div");
    			img4 = element("img");
    			t18 = space();
    			img5 = element("img");
    			t19 = space();
    			img6 = element("img");
    			t20 = space();
    			div5 = element("div");
    			img7 = element("img");
    			t21 = space();
    			img8 = element("img");
    			t22 = space();
    			img9 = element("img");
    			t23 = space();
    			section1 = element("section");
    			div6 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t24 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t26 = space();
    			input = element("input");
    			t27 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t29 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img0.src, img0_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img0, "src", img0_src_value);
    			attr_dev(img0, "class", "h-14 mr-3 mt-1");
    			attr_dev(img0, "alt", "Barbaros Logo");
    			add_location(img0, file$c, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$c, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$c, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$c, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$c, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$c, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$c, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$c, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$c, 31, 4, 1871);
    			add_location(li0, file$c, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$c, 34, 4, 1966);
    			add_location(li1, file$c, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$c, 37, 8, 2090);
    			add_location(li2, file$c, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$c, 40, 4, 2198);
    			add_location(li3, file$c, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$c, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$c, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$c, 14, 2, 402);
    			add_location(hr, file$c, 45, 2, 2339);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$c, 13, 0, 326);
    			if (!src_url_equal(img1.src, img1_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549196134322176/apartment.png?width=1263&height=671")) attr_dev(img1, "src", img1_src_value);
    			attr_dev(img1, "width", "500px");
    			set_style(img1, "border-radius", "10px");
    			add_location(img1, file$c, 50, 4, 2536);
    			if (!src_url_equal(img2.src, img2_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549213721038918/Bennys.png?width=1258&height=671")) attr_dev(img2, "src", img2_src_value);
    			attr_dev(img2, "width", "500px");
    			set_style(img2, "border-radius", "10px");
    			add_location(img2, file$c, 52, 4, 2765);
    			if (!src_url_equal(img3.src, img3_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549271128485999/pet_shop.png?width=1263&height=671")) attr_dev(img3, "src", img3_src_value);
    			attr_dev(img3, "width", "500px");
    			set_style(img3, "border-radius", "10px");
    			add_location(img3, file$c, 54, 4, 2991);
    			attr_dev(div3, "style", "display: flex; justify-content : space-around ; margin-top : 40px ; flex-wrap :wrap ; width : auto ");
    			add_location(div3, file$c, 48, 2, 2366);
    			if (!src_url_equal(img4.src, img4_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549260999237712/hospital2.png?width=1270&height=671")) attr_dev(img4, "src", img4_src_value);
    			attr_dev(img4, "width", "500px");
    			set_style(img4, "border-radius", "10px");
    			add_location(img4, file$c, 58, 4, 3331);
    			if (!src_url_equal(img5.src, img5_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549252912627792/hospital.png?width=1268&height=671")) attr_dev(img5, "src", img5_src_value);
    			attr_dev(img5, "width", "500px");
    			set_style(img5, "border-radius", "10px");
    			add_location(img5, file$c, 60, 4, 3560);
    			if (!src_url_equal(img6.src, img6_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549246335951079/gc.png?width=1287&height=671")) attr_dev(img6, "src", img6_src_value);
    			attr_dev(img6, "width", "500px");
    			set_style(img6, "border-radius", "10px");
    			add_location(img6, file$c, 62, 4, 3788);
    			attr_dev(div4, "style", "display: flex; justify-content : space-around ; margin-top : 40px ; flex-wrap :wrap ");
    			add_location(div4, file$c, 56, 2, 3176);
    			if (!src_url_equal(img7.src, img7_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549236504510574/cityhall.png?width=1265&height=671")) attr_dev(img7, "src", img7_src_value);
    			attr_dev(img7, "width", "500px");
    			set_style(img7, "border-radius", "10px");
    			add_location(img7, file$c, 66, 4, 4122);
    			if (!src_url_equal(img8.src, img8_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549227998453872/bennyys.png?width=1263&height=671")) attr_dev(img8, "src", img8_src_value);
    			attr_dev(img8, "width", "500px");
    			set_style(img8, "border-radius", "10px");
    			add_location(img8, file$c, 68, 4, 4350);
    			if (!src_url_equal(img9.src, img9_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133549274387456020/recycle.png?width=1318&height=671")) attr_dev(img9, "src", img9_src_value);
    			attr_dev(img9, "width", "500px");
    			set_style(img9, "border-radius", "10px");
    			add_location(img9, file$c, 70, 4, 4577);
    			attr_dev(div5, "style", "display: flex; justify-content : space-around ; margin-top : 40px ; flex-wrap :wrap");
    			add_location(div5, file$c, 64, 2, 3967);
    			add_location(section0, file$c, 47, 0, 2353);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$c, 80, 267, 5391);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$c, 80, 318, 5442);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$c, 80, 3, 5127);
    			add_location(button2, file$c, 79, 2, 5089);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$c, 82, 2, 5584);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$c, 83, 2, 5657);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$c, 84, 2, 5770);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$c, 85, 2, 5826);
    			attr_dev(div6, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div6, file$c, 78, 1, 5016);
    			attr_dev(section1, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section1, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section1, "z-index", "1000");
    			set_style(section1, "backdrop-filter", "blur(10px)");
    			set_style(section1, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section1, "display", "none");
    			attr_dev(section1, "id", "connect-overlay");
    			add_location(section1, file$c, 77, 0, 4780);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img0);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			append_dev(nav, t13);
    			append_dev(nav, hr);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section0, anchor);
    			append_dev(section0, div3);
    			append_dev(div3, img1);
    			append_dev(div3, t15);
    			append_dev(div3, img2);
    			append_dev(div3, t16);
    			append_dev(div3, img3);
    			append_dev(section0, t17);
    			append_dev(section0, div4);
    			append_dev(div4, img4);
    			append_dev(div4, t18);
    			append_dev(div4, img5);
    			append_dev(div4, t19);
    			append_dev(div4, img6);
    			append_dev(section0, t20);
    			append_dev(section0, div5);
    			append_dev(div5, img7);
    			append_dev(div5, t21);
    			append_dev(div5, img8);
    			append_dev(div5, t22);
    			append_dev(div5, img9);
    			insert_dev(target, t23, anchor);
    			insert_dev(target, section1, anchor);
    			append_dev(section1, div6);
    			append_dev(div6, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div6, t24);
    			append_dev(div6, p0);
    			append_dev(div6, t26);
    			append_dev(div6, input);
    			append_dev(div6, t27);
    			append_dev(div6, p1);
    			append_dev(div6, t29);
    			append_dev(div6, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$a, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$a, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section0);
    			if (detaching) detach_dev(t23);
    			if (detaching) detach_dev(section1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$d.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$a() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$a() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$d($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Safe', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Safe> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$a, close_overlay: close_overlay$a });
    	return [];
    }

    class Safe extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$d, create_fragment$d, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Safe",
    			options,
    			id: create_fragment$d.name
    		});
    	}
    }

    /* src\routes\Mortrp.svelte generated by Svelte v3.59.2 */

    const file$d = "src\\routes\\Mortrp.svelte";

    function create_fragment$e(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let iframe;
    	let iframe_src_value;
    	let t14;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t15;
    	let p0;
    	let t17;
    	let input;
    	let t18;
    	let p1;
    	let t20;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			iframe = element("iframe");
    			t14 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t15 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t20 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$d, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$d, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$d, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$d, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$d, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$d, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$d, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$d, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$d, 31, 4, 1871);
    			add_location(li0, file$d, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$d, 34, 4, 1966);
    			add_location(li1, file$d, 33, 4, 1956);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$d, 37, 8, 2090);
    			add_location(li2, file$d, 36, 6, 2076);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$d, 40, 4, 2198);
    			add_location(li3, file$d, 39, 4, 2188);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$d, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$d, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$d, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$d, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/rules-page/mort-rp.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$d, 46, 0, 2345);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$d, 50, 267, 3104);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$d, 50, 318, 3155);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$d, 50, 3, 2840);
    			add_location(button2, file$d, 49, 2, 2802);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$d, 52, 2, 3297);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$d, 53, 2, 3370);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$d, 54, 2, 3483);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$d, 55, 2, 3539);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$d, 48, 1, 2729);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$d, 47, 0, 2493);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t14, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t15);
    			append_dev(div3, p0);
    			append_dev(div3, t17);
    			append_dev(div3, input);
    			append_dev(div3, t18);
    			append_dev(div3, p1);
    			append_dev(div3, t20);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$b, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$b, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t14);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$e.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$b() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$b() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$e($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Mortrp', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Mortrp> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$b, close_overlay: close_overlay$b });
    	return [];
    }

    class Mortrp extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$e, create_fragment$e, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Mortrp",
    			options,
    			id: create_fragment$e.name
    		});
    	}
    }

    /* src\routes\Minigame.svelte generated by Svelte v3.59.2 */

    const file$e = "src\\routes\\Minigame.svelte";

    function create_fragment$f(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let iframe;
    	let iframe_src_value;
    	let t12;
    	let section;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t13;
    	let p0;
    	let t15;
    	let input;
    	let t16;
    	let p1;
    	let t18;
    	let a4;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span = element("span");
    			span.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Discord";
    			t11 = space();
    			iframe = element("iframe");
    			t12 = space();
    			section = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t13 = space();
    			p0 = element("p");
    			p0.textContent = "Connect Via IP:";
    			t15 = space();
    			input = element("input");
    			t16 = space();
    			p1 = element("p");
    			p1.textContent = "OR";
    			t18 = space();
    			a4 = element("a");
    			a4.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img.src, img_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "class", "h-14 mr-3 mt-1");
    			attr_dev(img, "alt", "Barbaros Logo");
    			add_location(img, file$e, 16, 4, 535);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$e, 15, 2, 491);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$e, 19, 4, 670);
    			attr_dev(span, "class", "sr-only");
    			add_location(span, file$e, 21, 4, 1270);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$e, 23, 6, 1434);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$e, 22, 4, 1319);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$e, 20, 4, 917);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$e, 18, 2, 635);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$e, 31, 4, 1871);
    			add_location(li0, file$e, 29, 4, 1810);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$e, 34, 4, 1966);
    			add_location(li1, file$e, 33, 4, 1956);
    			attr_dev(a3, "href", "https://discord.gg/barbaros");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$e, 37, 4, 2084);
    			add_location(li2, file$e, 36, 4, 2074);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$e, 28, 2, 1698);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$e, 27, 2, 1593);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$e, 14, 2, 402);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$e, 13, 0, 326);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/page/minigame.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			set_style(iframe, "min-height", "calc(100vh - 70px)");
    			add_location(iframe, file$e, 43, 0, 2231);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$e, 47, 267, 2985);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$e, 47, 318, 3036);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$e, 47, 3, 2721);
    			add_location(button2, file$e, 46, 2, 2683);
    			attr_dev(p0, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p0, file$e, 49, 2, 3178);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$e, 50, 2, 3251);
    			attr_dev(p1, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p1, file$e, 51, 2, 3364);
    			attr_dev(a4, "href", "fivem://connect/brrp.online");
    			attr_dev(a4, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a4, file$e, 52, 2, 3420);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$e, 45, 1, 2610);
    			attr_dev(section, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section, "z-index", "1000");
    			set_style(section, "backdrop-filter", "blur(10px)");
    			set_style(section, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section, "display", "none");
    			attr_dev(section, "id", "connect-overlay");
    			add_location(section, file$e, 44, 0, 2374);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			insert_dev(target, t11, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t12, anchor);
    			insert_dev(target, section, anchor);
    			append_dev(section, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t13);
    			append_dev(div3, p0);
    			append_dev(div3, t15);
    			append_dev(div3, input);
    			append_dev(div3, t16);
    			append_dev(div3, p1);
    			append_dev(div3, t18);
    			append_dev(div3, a4);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$c, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$c, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t11);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t12);
    			if (detaching) detach_dev(section);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$f.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$c() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$c() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$f($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Minigame', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Minigame> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$c, close_overlay: close_overlay$c });
    	return [];
    }

    class Minigame extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$f, create_fragment$f, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Minigame",
    			options,
    			id: create_fragment$f.name
    		});
    	}
    }

    /* src\routes\Peds.svelte generated by Svelte v3.59.2 */

    const file$f = "src\\routes\\Peds.svelte";

    function create_fragment$g(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img0;
    	let img0_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span0;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let section0;
    	let img1;
    	let img1_src_value;
    	let t14;
    	let p0;
    	let span1;
    	let t16;
    	let t17;
    	let p1;
    	let t19;
    	let section1;
    	let div7;
    	let div3;
    	let img2;
    	let img2_src_value;
    	let t20;
    	let p2;
    	let t22;
    	let div4;
    	let img3;
    	let img3_src_value;
    	let t23;
    	let p3;
    	let t25;
    	let div5;
    	let img4;
    	let img4_src_value;
    	let t26;
    	let p4;
    	let t28;
    	let div6;
    	let img5;
    	let img5_src_value;
    	let t29;
    	let p5;
    	let t31;
    	let div12;
    	let div8;
    	let img6;
    	let img6_src_value;
    	let t32;
    	let p6;
    	let t34;
    	let div9;
    	let img7;
    	let img7_src_value;
    	let t35;
    	let p7;
    	let t37;
    	let div10;
    	let img8;
    	let img8_src_value;
    	let t38;
    	let p8;
    	let t40;
    	let div11;
    	let img9;
    	let img9_src_value;
    	let t41;
    	let p9;
    	let t43;
    	let div17;
    	let div13;
    	let img10;
    	let img10_src_value;
    	let t44;
    	let p10;
    	let t46;
    	let div14;
    	let img11;
    	let img11_src_value;
    	let t47;
    	let p11;
    	let t49;
    	let div15;
    	let img12;
    	let img12_src_value;
    	let t50;
    	let p12;
    	let t52;
    	let div16;
    	let img13;
    	let img13_src_value;
    	let t53;
    	let p13;
    	let t55;
    	let div22;
    	let div18;
    	let img14;
    	let img14_src_value;
    	let t56;
    	let p14;
    	let t58;
    	let div19;
    	let img15;
    	let img15_src_value;
    	let t59;
    	let p15;
    	let t61;
    	let div20;
    	let img16;
    	let img16_src_value;
    	let t62;
    	let p16;
    	let t64;
    	let div21;
    	let img17;
    	let img17_src_value;
    	let t65;
    	let p17;
    	let t67;
    	let div27;
    	let div23;
    	let img18;
    	let img18_src_value;
    	let t68;
    	let p18;
    	let t70;
    	let div24;
    	let img19;
    	let img19_src_value;
    	let t71;
    	let p19;
    	let t73;
    	let div25;
    	let img20;
    	let img20_src_value;
    	let t74;
    	let p20;
    	let t76;
    	let div26;
    	let img21;
    	let img21_src_value;
    	let t77;
    	let p21;
    	let t79;
    	let div32;
    	let div28;
    	let img22;
    	let img22_src_value;
    	let t80;
    	let p22;
    	let t82;
    	let div29;
    	let img23;
    	let img23_src_value;
    	let t83;
    	let p23;
    	let t85;
    	let div30;
    	let img24;
    	let img24_src_value;
    	let t86;
    	let p24;
    	let t88;
    	let div31;
    	let img25;
    	let img25_src_value;
    	let t89;
    	let p25;
    	let t91;
    	let div37;
    	let div33;
    	let img26;
    	let img26_src_value;
    	let t92;
    	let p26;
    	let t94;
    	let div34;
    	let img27;
    	let img27_src_value;
    	let t95;
    	let p27;
    	let t97;
    	let div35;
    	let img28;
    	let img28_src_value;
    	let t98;
    	let p28;
    	let t100;
    	let div36;
    	let img29;
    	let img29_src_value;
    	let t101;
    	let p29;
    	let t103;
    	let div42;
    	let div38;
    	let img30;
    	let img30_src_value;
    	let t104;
    	let p30;
    	let t106;
    	let div39;
    	let img31;
    	let img31_src_value;
    	let t107;
    	let p31;
    	let t109;
    	let div40;
    	let img32;
    	let img32_src_value;
    	let t110;
    	let p32;
    	let t112;
    	let div41;
    	let img33;
    	let img33_src_value;
    	let t113;
    	let p33;
    	let t115;
    	let div47;
    	let div43;
    	let img34;
    	let img34_src_value;
    	let t116;
    	let p34;
    	let t118;
    	let div44;
    	let img35;
    	let img35_src_value;
    	let t119;
    	let p35;
    	let t121;
    	let div45;
    	let img36;
    	let img36_src_value;
    	let t122;
    	let p36;
    	let t124;
    	let div46;
    	let img37;
    	let img37_src_value;
    	let t125;
    	let p37;
    	let t127;
    	let div52;
    	let div48;
    	let img38;
    	let img38_src_value;
    	let t128;
    	let p38;
    	let t130;
    	let div49;
    	let img39;
    	let img39_src_value;
    	let t131;
    	let p39;
    	let t133;
    	let div50;
    	let img40;
    	let img40_src_value;
    	let t134;
    	let p40;
    	let t136;
    	let div51;
    	let img41;
    	let img41_src_value;
    	let t137;
    	let p41;
    	let t139;
    	let div57;
    	let div53;
    	let img42;
    	let img42_src_value;
    	let t140;
    	let p42;
    	let t142;
    	let div54;
    	let img43;
    	let img43_src_value;
    	let t143;
    	let p43;
    	let t145;
    	let div55;
    	let img44;
    	let img44_src_value;
    	let t146;
    	let p44;
    	let t148;
    	let div56;
    	let img45;
    	let img45_src_value;
    	let t149;
    	let p45;
    	let t151;
    	let div62;
    	let div58;
    	let img46;
    	let img46_src_value;
    	let t152;
    	let p46;
    	let t154;
    	let div59;
    	let img47;
    	let img47_src_value;
    	let t155;
    	let p47;
    	let t157;
    	let div60;
    	let img48;
    	let img48_src_value;
    	let t158;
    	let p48;
    	let t160;
    	let div61;
    	let img49;
    	let img49_src_value;
    	let t161;
    	let p49;
    	let t163;
    	let div67;
    	let div63;
    	let img50;
    	let img50_src_value;
    	let t164;
    	let p50;
    	let t166;
    	let div64;
    	let img51;
    	let img51_src_value;
    	let t167;
    	let p51;
    	let t169;
    	let div65;
    	let img52;
    	let img52_src_value;
    	let t170;
    	let p52;
    	let t172;
    	let div66;
    	let img53;
    	let img53_src_value;
    	let t173;
    	let p53;
    	let t175;
    	let div72;
    	let div68;
    	let img54;
    	let img54_src_value;
    	let t176;
    	let p54;
    	let t178;
    	let div69;
    	let img55;
    	let img55_src_value;
    	let t179;
    	let p55;
    	let t181;
    	let div70;
    	let img56;
    	let img56_src_value;
    	let t182;
    	let p56;
    	let t184;
    	let div71;
    	let img57;
    	let img57_src_value;
    	let t185;
    	let p57;
    	let t187;
    	let div77;
    	let div73;
    	let img58;
    	let img58_src_value;
    	let t188;
    	let p58;
    	let t190;
    	let div74;
    	let img59;
    	let img59_src_value;
    	let t191;
    	let p59;
    	let t193;
    	let div75;
    	let img60;
    	let img60_src_value;
    	let t194;
    	let p60;
    	let t196;
    	let div76;
    	let img61;
    	let img61_src_value;
    	let t197;
    	let p61;
    	let t199;
    	let div82;
    	let div78;
    	let img62;
    	let img62_src_value;
    	let t200;
    	let p62;
    	let t202;
    	let div79;
    	let img63;
    	let img63_src_value;
    	let t203;
    	let p63;
    	let t205;
    	let div80;
    	let img64;
    	let img64_src_value;
    	let t206;
    	let p64;
    	let t208;
    	let div81;
    	let img65;
    	let img65_src_value;
    	let t209;
    	let p65;
    	let t211;
    	let div87;
    	let div83;
    	let img66;
    	let img66_src_value;
    	let t212;
    	let p66;
    	let t214;
    	let div84;
    	let img67;
    	let img67_src_value;
    	let t215;
    	let p67;
    	let t217;
    	let div85;
    	let img68;
    	let img68_src_value;
    	let t218;
    	let p68;
    	let t220;
    	let div86;
    	let img69;
    	let img69_src_value;
    	let t221;
    	let p69;
    	let t223;
    	let div92;
    	let div88;
    	let img70;
    	let img70_src_value;
    	let t224;
    	let p70;
    	let t226;
    	let div89;
    	let img71;
    	let img71_src_value;
    	let t227;
    	let p71;
    	let t229;
    	let div90;
    	let img72;
    	let img72_src_value;
    	let t230;
    	let p72;
    	let t232;
    	let div91;
    	let img73;
    	let img73_src_value;
    	let t233;
    	let p73;
    	let t235;
    	let div97;
    	let div93;
    	let img74;
    	let img74_src_value;
    	let t236;
    	let p74;
    	let t238;
    	let div94;
    	let img75;
    	let img75_src_value;
    	let t239;
    	let p75;
    	let t241;
    	let div95;
    	let img76;
    	let img76_src_value;
    	let t242;
    	let p76;
    	let t244;
    	let div96;
    	let img77;
    	let img77_src_value;
    	let t245;
    	let p77;
    	let t247;
    	let div102;
    	let div98;
    	let img78;
    	let img78_src_value;
    	let t248;
    	let p78;
    	let t250;
    	let div99;
    	let img79;
    	let img79_src_value;
    	let t251;
    	let p79;
    	let t253;
    	let div100;
    	let img80;
    	let img80_src_value;
    	let t254;
    	let p80;
    	let t256;
    	let div101;
    	let img81;
    	let img81_src_value;
    	let t257;
    	let p81;
    	let t259;
    	let div107;
    	let div103;
    	let img82;
    	let img82_src_value;
    	let t260;
    	let p82;
    	let t262;
    	let div104;
    	let img83;
    	let img83_src_value;
    	let t263;
    	let p83;
    	let t265;
    	let div105;
    	let img84;
    	let img84_src_value;
    	let t266;
    	let p84;
    	let t268;
    	let div106;
    	let img85;
    	let img85_src_value;
    	let t269;
    	let p85;
    	let t271;
    	let div112;
    	let div108;
    	let img86;
    	let img86_src_value;
    	let t272;
    	let p86;
    	let t274;
    	let div109;
    	let img87;
    	let img87_src_value;
    	let t275;
    	let p87;
    	let t277;
    	let div110;
    	let img88;
    	let img88_src_value;
    	let t278;
    	let p88;
    	let t280;
    	let div111;
    	let img89;
    	let img89_src_value;
    	let t281;
    	let p89;
    	let t283;
    	let div117;
    	let div113;
    	let img90;
    	let img90_src_value;
    	let t284;
    	let p90;
    	let t286;
    	let div114;
    	let img91;
    	let img91_src_value;
    	let t287;
    	let p91;
    	let t289;
    	let div115;
    	let img92;
    	let img92_src_value;
    	let t290;
    	let p92;
    	let t292;
    	let div116;
    	let img93;
    	let img93_src_value;
    	let t293;
    	let p93;
    	let t295;
    	let div122;
    	let div118;
    	let img94;
    	let img94_src_value;
    	let t296;
    	let p94;
    	let t298;
    	let div119;
    	let img95;
    	let img95_src_value;
    	let t299;
    	let p95;
    	let t301;
    	let div120;
    	let img96;
    	let img96_src_value;
    	let t302;
    	let p96;
    	let t304;
    	let div121;
    	let img97;
    	let img97_src_value;
    	let t305;
    	let p97;
    	let t307;
    	let div127;
    	let div123;
    	let img98;
    	let img98_src_value;
    	let t308;
    	let p98;
    	let t310;
    	let div124;
    	let img99;
    	let img99_src_value;
    	let t311;
    	let p99;
    	let t313;
    	let div125;
    	let img100;
    	let img100_src_value;
    	let t314;
    	let p100;
    	let t316;
    	let div126;
    	let img101;
    	let img101_src_value;
    	let t317;
    	let p101;
    	let t319;
    	let div132;
    	let div128;
    	let img102;
    	let img102_src_value;
    	let t320;
    	let p102;
    	let t322;
    	let div129;
    	let img103;
    	let img103_src_value;
    	let t323;
    	let p103;
    	let t325;
    	let div130;
    	let img104;
    	let img104_src_value;
    	let t326;
    	let p104;
    	let t328;
    	let div131;
    	let img105;
    	let img105_src_value;
    	let t329;
    	let p105;
    	let t331;
    	let div137;
    	let div133;
    	let img106;
    	let img106_src_value;
    	let t332;
    	let p106;
    	let t334;
    	let div134;
    	let img107;
    	let img107_src_value;
    	let t335;
    	let p107;
    	let t337;
    	let div135;
    	let img108;
    	let img108_src_value;
    	let t338;
    	let p108;
    	let t340;
    	let div136;
    	let img109;
    	let img109_src_value;
    	let t341;
    	let p109;
    	let t343;
    	let div142;
    	let div138;
    	let img110;
    	let img110_src_value;
    	let t344;
    	let p110;
    	let t346;
    	let div139;
    	let img111;
    	let img111_src_value;
    	let t347;
    	let p111;
    	let t349;
    	let div140;
    	let img112;
    	let img112_src_value;
    	let t350;
    	let p112;
    	let t352;
    	let div141;
    	let img113;
    	let img113_src_value;
    	let t353;
    	let p113;
    	let t355;
    	let div147;
    	let div143;
    	let img114;
    	let img114_src_value;
    	let t356;
    	let p114;
    	let t358;
    	let div144;
    	let img115;
    	let img115_src_value;
    	let t359;
    	let p115;
    	let t361;
    	let div145;
    	let img116;
    	let img116_src_value;
    	let t362;
    	let p116;
    	let t364;
    	let div146;
    	let img117;
    	let img117_src_value;
    	let t365;
    	let p117;
    	let t367;
    	let div152;
    	let div148;
    	let img118;
    	let img118_src_value;
    	let t368;
    	let p118;
    	let t370;
    	let div149;
    	let img119;
    	let img119_src_value;
    	let t371;
    	let p119;
    	let t373;
    	let div150;
    	let img120;
    	let img120_src_value;
    	let t374;
    	let p120;
    	let t376;
    	let div151;
    	let img121;
    	let img121_src_value;
    	let t377;
    	let p121;
    	let t379;
    	let div157;
    	let div153;
    	let img122;
    	let img122_src_value;
    	let t380;
    	let p122;
    	let t382;
    	let div154;
    	let img123;
    	let img123_src_value;
    	let t383;
    	let p123;
    	let t385;
    	let div155;
    	let img124;
    	let img124_src_value;
    	let t386;
    	let p124;
    	let t388;
    	let div156;
    	let img125;
    	let img125_src_value;
    	let t389;
    	let p125;
    	let t391;
    	let div162;
    	let div158;
    	let img126;
    	let img126_src_value;
    	let t392;
    	let p126;
    	let t394;
    	let div159;
    	let img127;
    	let img127_src_value;
    	let t395;
    	let p127;
    	let t397;
    	let div160;
    	let img128;
    	let img128_src_value;
    	let t398;
    	let p128;
    	let t400;
    	let div161;
    	let img129;
    	let img129_src_value;
    	let t401;
    	let p129;
    	let t403;
    	let section2;
    	let div163;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t404;
    	let p130;
    	let t406;
    	let input;
    	let t407;
    	let p131;
    	let t409;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img0 = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span0 = element("span");
    			span0.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			section0 = element("section");
    			img1 = element("img");
    			t14 = space();
    			p0 = element("p");
    			span1 = element("span");
    			span1.textContent = "Add-On ";
    			t16 = text("Peds");
    			t17 = space();
    			p1 = element("p");
    			p1.textContent = "Welcome to our FiveM role play server! We are thrilled to introduce our latest add-on, \"peds.\" With this exciting addition, you can now enjoy a wide variety of new and unique player models, enhancing your role play experience like never before. Immerse yourself in the city's diverse population and create memorable moments with our enhanced character customization options. Join us now and explore the endless possibilities that \"peds\" bring to our vibrant community!Check our discord Server for more details/informations about our companies.";
    			t19 = space();
    			section1 = element("section");
    			div7 = element("div");
    			div3 = element("div");
    			img2 = element("img");
    			t20 = space();
    			p2 = element("p");
    			p2.textContent = "1";
    			t22 = space();
    			div4 = element("div");
    			img3 = element("img");
    			t23 = space();
    			p3 = element("p");
    			p3.textContent = "2";
    			t25 = space();
    			div5 = element("div");
    			img4 = element("img");
    			t26 = space();
    			p4 = element("p");
    			p4.textContent = "3";
    			t28 = space();
    			div6 = element("div");
    			img5 = element("img");
    			t29 = space();
    			p5 = element("p");
    			p5.textContent = "4";
    			t31 = space();
    			div12 = element("div");
    			div8 = element("div");
    			img6 = element("img");
    			t32 = space();
    			p6 = element("p");
    			p6.textContent = "5";
    			t34 = space();
    			div9 = element("div");
    			img7 = element("img");
    			t35 = space();
    			p7 = element("p");
    			p7.textContent = "6";
    			t37 = space();
    			div10 = element("div");
    			img8 = element("img");
    			t38 = space();
    			p8 = element("p");
    			p8.textContent = "7";
    			t40 = space();
    			div11 = element("div");
    			img9 = element("img");
    			t41 = space();
    			p9 = element("p");
    			p9.textContent = "8";
    			t43 = space();
    			div17 = element("div");
    			div13 = element("div");
    			img10 = element("img");
    			t44 = space();
    			p10 = element("p");
    			p10.textContent = "9";
    			t46 = space();
    			div14 = element("div");
    			img11 = element("img");
    			t47 = space();
    			p11 = element("p");
    			p11.textContent = "10";
    			t49 = space();
    			div15 = element("div");
    			img12 = element("img");
    			t50 = space();
    			p12 = element("p");
    			p12.textContent = "11";
    			t52 = space();
    			div16 = element("div");
    			img13 = element("img");
    			t53 = space();
    			p13 = element("p");
    			p13.textContent = "12";
    			t55 = space();
    			div22 = element("div");
    			div18 = element("div");
    			img14 = element("img");
    			t56 = space();
    			p14 = element("p");
    			p14.textContent = "13";
    			t58 = space();
    			div19 = element("div");
    			img15 = element("img");
    			t59 = space();
    			p15 = element("p");
    			p15.textContent = "14";
    			t61 = space();
    			div20 = element("div");
    			img16 = element("img");
    			t62 = space();
    			p16 = element("p");
    			p16.textContent = "15";
    			t64 = space();
    			div21 = element("div");
    			img17 = element("img");
    			t65 = space();
    			p17 = element("p");
    			p17.textContent = "16";
    			t67 = space();
    			div27 = element("div");
    			div23 = element("div");
    			img18 = element("img");
    			t68 = space();
    			p18 = element("p");
    			p18.textContent = "17";
    			t70 = space();
    			div24 = element("div");
    			img19 = element("img");
    			t71 = space();
    			p19 = element("p");
    			p19.textContent = "18";
    			t73 = space();
    			div25 = element("div");
    			img20 = element("img");
    			t74 = space();
    			p20 = element("p");
    			p20.textContent = "19";
    			t76 = space();
    			div26 = element("div");
    			img21 = element("img");
    			t77 = space();
    			p21 = element("p");
    			p21.textContent = "20";
    			t79 = space();
    			div32 = element("div");
    			div28 = element("div");
    			img22 = element("img");
    			t80 = space();
    			p22 = element("p");
    			p22.textContent = "21";
    			t82 = space();
    			div29 = element("div");
    			img23 = element("img");
    			t83 = space();
    			p23 = element("p");
    			p23.textContent = "22";
    			t85 = space();
    			div30 = element("div");
    			img24 = element("img");
    			t86 = space();
    			p24 = element("p");
    			p24.textContent = "23";
    			t88 = space();
    			div31 = element("div");
    			img25 = element("img");
    			t89 = space();
    			p25 = element("p");
    			p25.textContent = "24";
    			t91 = space();
    			div37 = element("div");
    			div33 = element("div");
    			img26 = element("img");
    			t92 = space();
    			p26 = element("p");
    			p26.textContent = "25";
    			t94 = space();
    			div34 = element("div");
    			img27 = element("img");
    			t95 = space();
    			p27 = element("p");
    			p27.textContent = "26";
    			t97 = space();
    			div35 = element("div");
    			img28 = element("img");
    			t98 = space();
    			p28 = element("p");
    			p28.textContent = "27";
    			t100 = space();
    			div36 = element("div");
    			img29 = element("img");
    			t101 = space();
    			p29 = element("p");
    			p29.textContent = "28";
    			t103 = space();
    			div42 = element("div");
    			div38 = element("div");
    			img30 = element("img");
    			t104 = space();
    			p30 = element("p");
    			p30.textContent = "29";
    			t106 = space();
    			div39 = element("div");
    			img31 = element("img");
    			t107 = space();
    			p31 = element("p");
    			p31.textContent = "30";
    			t109 = space();
    			div40 = element("div");
    			img32 = element("img");
    			t110 = space();
    			p32 = element("p");
    			p32.textContent = "31";
    			t112 = space();
    			div41 = element("div");
    			img33 = element("img");
    			t113 = space();
    			p33 = element("p");
    			p33.textContent = "32";
    			t115 = space();
    			div47 = element("div");
    			div43 = element("div");
    			img34 = element("img");
    			t116 = space();
    			p34 = element("p");
    			p34.textContent = "33";
    			t118 = space();
    			div44 = element("div");
    			img35 = element("img");
    			t119 = space();
    			p35 = element("p");
    			p35.textContent = "34";
    			t121 = space();
    			div45 = element("div");
    			img36 = element("img");
    			t122 = space();
    			p36 = element("p");
    			p36.textContent = "35";
    			t124 = space();
    			div46 = element("div");
    			img37 = element("img");
    			t125 = space();
    			p37 = element("p");
    			p37.textContent = "36";
    			t127 = space();
    			div52 = element("div");
    			div48 = element("div");
    			img38 = element("img");
    			t128 = space();
    			p38 = element("p");
    			p38.textContent = "37";
    			t130 = space();
    			div49 = element("div");
    			img39 = element("img");
    			t131 = space();
    			p39 = element("p");
    			p39.textContent = "38";
    			t133 = space();
    			div50 = element("div");
    			img40 = element("img");
    			t134 = space();
    			p40 = element("p");
    			p40.textContent = "39";
    			t136 = space();
    			div51 = element("div");
    			img41 = element("img");
    			t137 = space();
    			p41 = element("p");
    			p41.textContent = "40";
    			t139 = space();
    			div57 = element("div");
    			div53 = element("div");
    			img42 = element("img");
    			t140 = space();
    			p42 = element("p");
    			p42.textContent = "41";
    			t142 = space();
    			div54 = element("div");
    			img43 = element("img");
    			t143 = space();
    			p43 = element("p");
    			p43.textContent = "42";
    			t145 = space();
    			div55 = element("div");
    			img44 = element("img");
    			t146 = space();
    			p44 = element("p");
    			p44.textContent = "43";
    			t148 = space();
    			div56 = element("div");
    			img45 = element("img");
    			t149 = space();
    			p45 = element("p");
    			p45.textContent = "44";
    			t151 = space();
    			div62 = element("div");
    			div58 = element("div");
    			img46 = element("img");
    			t152 = space();
    			p46 = element("p");
    			p46.textContent = "45";
    			t154 = space();
    			div59 = element("div");
    			img47 = element("img");
    			t155 = space();
    			p47 = element("p");
    			p47.textContent = "46";
    			t157 = space();
    			div60 = element("div");
    			img48 = element("img");
    			t158 = space();
    			p48 = element("p");
    			p48.textContent = "47";
    			t160 = space();
    			div61 = element("div");
    			img49 = element("img");
    			t161 = space();
    			p49 = element("p");
    			p49.textContent = "48";
    			t163 = space();
    			div67 = element("div");
    			div63 = element("div");
    			img50 = element("img");
    			t164 = space();
    			p50 = element("p");
    			p50.textContent = "49";
    			t166 = space();
    			div64 = element("div");
    			img51 = element("img");
    			t167 = space();
    			p51 = element("p");
    			p51.textContent = "50";
    			t169 = space();
    			div65 = element("div");
    			img52 = element("img");
    			t170 = space();
    			p52 = element("p");
    			p52.textContent = "51";
    			t172 = space();
    			div66 = element("div");
    			img53 = element("img");
    			t173 = space();
    			p53 = element("p");
    			p53.textContent = "52";
    			t175 = space();
    			div72 = element("div");
    			div68 = element("div");
    			img54 = element("img");
    			t176 = space();
    			p54 = element("p");
    			p54.textContent = "53";
    			t178 = space();
    			div69 = element("div");
    			img55 = element("img");
    			t179 = space();
    			p55 = element("p");
    			p55.textContent = "54";
    			t181 = space();
    			div70 = element("div");
    			img56 = element("img");
    			t182 = space();
    			p56 = element("p");
    			p56.textContent = "55";
    			t184 = space();
    			div71 = element("div");
    			img57 = element("img");
    			t185 = space();
    			p57 = element("p");
    			p57.textContent = "56";
    			t187 = space();
    			div77 = element("div");
    			div73 = element("div");
    			img58 = element("img");
    			t188 = space();
    			p58 = element("p");
    			p58.textContent = "57";
    			t190 = space();
    			div74 = element("div");
    			img59 = element("img");
    			t191 = space();
    			p59 = element("p");
    			p59.textContent = "58";
    			t193 = space();
    			div75 = element("div");
    			img60 = element("img");
    			t194 = space();
    			p60 = element("p");
    			p60.textContent = "59";
    			t196 = space();
    			div76 = element("div");
    			img61 = element("img");
    			t197 = space();
    			p61 = element("p");
    			p61.textContent = "60";
    			t199 = space();
    			div82 = element("div");
    			div78 = element("div");
    			img62 = element("img");
    			t200 = space();
    			p62 = element("p");
    			p62.textContent = "60";
    			t202 = space();
    			div79 = element("div");
    			img63 = element("img");
    			t203 = space();
    			p63 = element("p");
    			p63.textContent = "61";
    			t205 = space();
    			div80 = element("div");
    			img64 = element("img");
    			t206 = space();
    			p64 = element("p");
    			p64.textContent = "62";
    			t208 = space();
    			div81 = element("div");
    			img65 = element("img");
    			t209 = space();
    			p65 = element("p");
    			p65.textContent = "63";
    			t211 = space();
    			div87 = element("div");
    			div83 = element("div");
    			img66 = element("img");
    			t212 = space();
    			p66 = element("p");
    			p66.textContent = "64";
    			t214 = space();
    			div84 = element("div");
    			img67 = element("img");
    			t215 = space();
    			p67 = element("p");
    			p67.textContent = "65";
    			t217 = space();
    			div85 = element("div");
    			img68 = element("img");
    			t218 = space();
    			p68 = element("p");
    			p68.textContent = "66";
    			t220 = space();
    			div86 = element("div");
    			img69 = element("img");
    			t221 = space();
    			p69 = element("p");
    			p69.textContent = "67";
    			t223 = space();
    			div92 = element("div");
    			div88 = element("div");
    			img70 = element("img");
    			t224 = space();
    			p70 = element("p");
    			p70.textContent = "68";
    			t226 = space();
    			div89 = element("div");
    			img71 = element("img");
    			t227 = space();
    			p71 = element("p");
    			p71.textContent = "69";
    			t229 = space();
    			div90 = element("div");
    			img72 = element("img");
    			t230 = space();
    			p72 = element("p");
    			p72.textContent = "70";
    			t232 = space();
    			div91 = element("div");
    			img73 = element("img");
    			t233 = space();
    			p73 = element("p");
    			p73.textContent = "71";
    			t235 = space();
    			div97 = element("div");
    			div93 = element("div");
    			img74 = element("img");
    			t236 = space();
    			p74 = element("p");
    			p74.textContent = "72";
    			t238 = space();
    			div94 = element("div");
    			img75 = element("img");
    			t239 = space();
    			p75 = element("p");
    			p75.textContent = "73";
    			t241 = space();
    			div95 = element("div");
    			img76 = element("img");
    			t242 = space();
    			p76 = element("p");
    			p76.textContent = "74";
    			t244 = space();
    			div96 = element("div");
    			img77 = element("img");
    			t245 = space();
    			p77 = element("p");
    			p77.textContent = "75";
    			t247 = space();
    			div102 = element("div");
    			div98 = element("div");
    			img78 = element("img");
    			t248 = space();
    			p78 = element("p");
    			p78.textContent = "76";
    			t250 = space();
    			div99 = element("div");
    			img79 = element("img");
    			t251 = space();
    			p79 = element("p");
    			p79.textContent = "77";
    			t253 = space();
    			div100 = element("div");
    			img80 = element("img");
    			t254 = space();
    			p80 = element("p");
    			p80.textContent = "78";
    			t256 = space();
    			div101 = element("div");
    			img81 = element("img");
    			t257 = space();
    			p81 = element("p");
    			p81.textContent = "79";
    			t259 = space();
    			div107 = element("div");
    			div103 = element("div");
    			img82 = element("img");
    			t260 = space();
    			p82 = element("p");
    			p82.textContent = "80";
    			t262 = space();
    			div104 = element("div");
    			img83 = element("img");
    			t263 = space();
    			p83 = element("p");
    			p83.textContent = "81";
    			t265 = space();
    			div105 = element("div");
    			img84 = element("img");
    			t266 = space();
    			p84 = element("p");
    			p84.textContent = "82";
    			t268 = space();
    			div106 = element("div");
    			img85 = element("img");
    			t269 = space();
    			p85 = element("p");
    			p85.textContent = "83";
    			t271 = space();
    			div112 = element("div");
    			div108 = element("div");
    			img86 = element("img");
    			t272 = space();
    			p86 = element("p");
    			p86.textContent = "84";
    			t274 = space();
    			div109 = element("div");
    			img87 = element("img");
    			t275 = space();
    			p87 = element("p");
    			p87.textContent = "85";
    			t277 = space();
    			div110 = element("div");
    			img88 = element("img");
    			t278 = space();
    			p88 = element("p");
    			p88.textContent = "86";
    			t280 = space();
    			div111 = element("div");
    			img89 = element("img");
    			t281 = space();
    			p89 = element("p");
    			p89.textContent = "87";
    			t283 = space();
    			div117 = element("div");
    			div113 = element("div");
    			img90 = element("img");
    			t284 = space();
    			p90 = element("p");
    			p90.textContent = "88";
    			t286 = space();
    			div114 = element("div");
    			img91 = element("img");
    			t287 = space();
    			p91 = element("p");
    			p91.textContent = "89";
    			t289 = space();
    			div115 = element("div");
    			img92 = element("img");
    			t290 = space();
    			p92 = element("p");
    			p92.textContent = "90";
    			t292 = space();
    			div116 = element("div");
    			img93 = element("img");
    			t293 = space();
    			p93 = element("p");
    			p93.textContent = "91";
    			t295 = space();
    			div122 = element("div");
    			div118 = element("div");
    			img94 = element("img");
    			t296 = space();
    			p94 = element("p");
    			p94.textContent = "92";
    			t298 = space();
    			div119 = element("div");
    			img95 = element("img");
    			t299 = space();
    			p95 = element("p");
    			p95.textContent = "93";
    			t301 = space();
    			div120 = element("div");
    			img96 = element("img");
    			t302 = space();
    			p96 = element("p");
    			p96.textContent = "94";
    			t304 = space();
    			div121 = element("div");
    			img97 = element("img");
    			t305 = space();
    			p97 = element("p");
    			p97.textContent = "95";
    			t307 = space();
    			div127 = element("div");
    			div123 = element("div");
    			img98 = element("img");
    			t308 = space();
    			p98 = element("p");
    			p98.textContent = "96";
    			t310 = space();
    			div124 = element("div");
    			img99 = element("img");
    			t311 = space();
    			p99 = element("p");
    			p99.textContent = "97";
    			t313 = space();
    			div125 = element("div");
    			img100 = element("img");
    			t314 = space();
    			p100 = element("p");
    			p100.textContent = "98";
    			t316 = space();
    			div126 = element("div");
    			img101 = element("img");
    			t317 = space();
    			p101 = element("p");
    			p101.textContent = "99";
    			t319 = space();
    			div132 = element("div");
    			div128 = element("div");
    			img102 = element("img");
    			t320 = space();
    			p102 = element("p");
    			p102.textContent = "100";
    			t322 = space();
    			div129 = element("div");
    			img103 = element("img");
    			t323 = space();
    			p103 = element("p");
    			p103.textContent = "101";
    			t325 = space();
    			div130 = element("div");
    			img104 = element("img");
    			t326 = space();
    			p104 = element("p");
    			p104.textContent = "102";
    			t328 = space();
    			div131 = element("div");
    			img105 = element("img");
    			t329 = space();
    			p105 = element("p");
    			p105.textContent = "103";
    			t331 = space();
    			div137 = element("div");
    			div133 = element("div");
    			img106 = element("img");
    			t332 = space();
    			p106 = element("p");
    			p106.textContent = "104";
    			t334 = space();
    			div134 = element("div");
    			img107 = element("img");
    			t335 = space();
    			p107 = element("p");
    			p107.textContent = "105";
    			t337 = space();
    			div135 = element("div");
    			img108 = element("img");
    			t338 = space();
    			p108 = element("p");
    			p108.textContent = "106";
    			t340 = space();
    			div136 = element("div");
    			img109 = element("img");
    			t341 = space();
    			p109 = element("p");
    			p109.textContent = "107";
    			t343 = space();
    			div142 = element("div");
    			div138 = element("div");
    			img110 = element("img");
    			t344 = space();
    			p110 = element("p");
    			p110.textContent = "108";
    			t346 = space();
    			div139 = element("div");
    			img111 = element("img");
    			t347 = space();
    			p111 = element("p");
    			p111.textContent = "109";
    			t349 = space();
    			div140 = element("div");
    			img112 = element("img");
    			t350 = space();
    			p112 = element("p");
    			p112.textContent = "110";
    			t352 = space();
    			div141 = element("div");
    			img113 = element("img");
    			t353 = space();
    			p113 = element("p");
    			p113.textContent = "111";
    			t355 = space();
    			div147 = element("div");
    			div143 = element("div");
    			img114 = element("img");
    			t356 = space();
    			p114 = element("p");
    			p114.textContent = "112";
    			t358 = space();
    			div144 = element("div");
    			img115 = element("img");
    			t359 = space();
    			p115 = element("p");
    			p115.textContent = "113";
    			t361 = space();
    			div145 = element("div");
    			img116 = element("img");
    			t362 = space();
    			p116 = element("p");
    			p116.textContent = "114";
    			t364 = space();
    			div146 = element("div");
    			img117 = element("img");
    			t365 = space();
    			p117 = element("p");
    			p117.textContent = "115";
    			t367 = space();
    			div152 = element("div");
    			div148 = element("div");
    			img118 = element("img");
    			t368 = space();
    			p118 = element("p");
    			p118.textContent = "116";
    			t370 = space();
    			div149 = element("div");
    			img119 = element("img");
    			t371 = space();
    			p119 = element("p");
    			p119.textContent = "117";
    			t373 = space();
    			div150 = element("div");
    			img120 = element("img");
    			t374 = space();
    			p120 = element("p");
    			p120.textContent = "118";
    			t376 = space();
    			div151 = element("div");
    			img121 = element("img");
    			t377 = space();
    			p121 = element("p");
    			p121.textContent = "119";
    			t379 = space();
    			div157 = element("div");
    			div153 = element("div");
    			img122 = element("img");
    			t380 = space();
    			p122 = element("p");
    			p122.textContent = "120";
    			t382 = space();
    			div154 = element("div");
    			img123 = element("img");
    			t383 = space();
    			p123 = element("p");
    			p123.textContent = "121";
    			t385 = space();
    			div155 = element("div");
    			img124 = element("img");
    			t386 = space();
    			p124 = element("p");
    			p124.textContent = "122";
    			t388 = space();
    			div156 = element("div");
    			img125 = element("img");
    			t389 = space();
    			p125 = element("p");
    			p125.textContent = "123";
    			t391 = space();
    			div162 = element("div");
    			div158 = element("div");
    			img126 = element("img");
    			t392 = space();
    			p126 = element("p");
    			p126.textContent = "124";
    			t394 = space();
    			div159 = element("div");
    			img127 = element("img");
    			t395 = space();
    			p127 = element("p");
    			p127.textContent = "125";
    			t397 = space();
    			div160 = element("div");
    			img128 = element("img");
    			t398 = space();
    			p128 = element("p");
    			p128.textContent = "126";
    			t400 = space();
    			div161 = element("div");
    			img129 = element("img");
    			t401 = space();
    			p129 = element("p");
    			p129.textContent = "127";
    			t403 = space();
    			section2 = element("section");
    			div163 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t404 = space();
    			p130 = element("p");
    			p130.textContent = "Connect Via IP:";
    			t406 = space();
    			input = element("input");
    			t407 = space();
    			p131 = element("p");
    			p131.textContent = "OR";
    			t409 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img0.src, img0_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img0, "src", img0_src_value);
    			attr_dev(img0, "class", "h-14 mr-3 mt-1");
    			attr_dev(img0, "alt", "Barbaros Logo");
    			add_location(img0, file$f, 27, 8, 1105);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$f, 26, 6, 1057);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$f, 30, 8, 1252);
    			attr_dev(span0, "class", "sr-only");
    			add_location(span0, file$f, 32, 8, 1860);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$f, 34, 10, 2032);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$f, 33, 8, 1913);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$f, 31, 8, 1503);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$f, 29, 6, 1213);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$f, 42, 8, 2501);
    			add_location(li0, file$f, 40, 8, 2432);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$f, 45, 8, 2608);
    			add_location(li1, file$f, 44, 8, 2594);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$f, 48, 12, 2744);
    			add_location(li2, file$f, 47, 10, 2726);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$f, 51, 8, 2864);
    			add_location(li3, file$f, 50, 8, 2850);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$f, 39, 6, 2316);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$f, 38, 6, 2207);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$f, 25, 6, 964);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$f, 24, 4, 884);
    			if (!src_url_equal(img1.src, img1_src_value = "/assets/img/left-fly-community.png")) attr_dev(img1, "src", img1_src_value);
    			attr_dev(img1, "alt", "Object");
    			attr_dev(img1, "class", "absolute right-0");
    			add_location(img1, file$f, 58, 8, 3103);
    			attr_dev(span1, "class", "text-[#7C5BF1]");
    			add_location(span1, file$f, 59, 53, 3242);
    			attr_dev(p0, "class", "text-5xl font-bold text-[#2F344F]");
    			add_location(p0, file$f, 59, 8, 3197);
    			attr_dev(p1, "class", "text-lg mt-4 text-[#2F344F] text-center w-2/4");
    			add_location(p1, file$f, 60, 8, 3303);
    			attr_dev(section0, "class", "flex flex-col items-center relative mt-8");
    			add_location(section0, file$f, 57, 4, 3035);
    			if (!src_url_equal(img2.src, img2_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133787605775945890/image.png?width=742&height=671")) attr_dev(img2, "src", img2_src_value);
    			set_style(img2, "border-radius", "10px");
    			set_style(img2, "width", "300px");
    			set_style(img2, "height", "320px");
    			add_location(img2, file$f, 68, 6, 4226);
    			attr_dev(p2, "id", "ped-name");
    			set_style(p2, "text-align", "center");
    			attr_dev(p2, "class", "svelte-1qp9z6g");
    			add_location(p2, file$f, 69, 6, 4415);
    			add_location(div3, file$f, 66, 4, 4158);
    			if (!src_url_equal(img3.src, img3_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133787800932728876/image.png")) attr_dev(img3, "src", img3_src_value);
    			set_style(img3, "border-radius", "10px");
    			set_style(img3, "width", "300px");
    			set_style(img3, "height", "320px");
    			add_location(img3, file$f, 73, 6, 4552);
    			attr_dev(p3, "id", "ped-name");
    			set_style(p3, "text-align", "center");
    			attr_dev(p3, "class", "svelte-1qp9z6g");
    			add_location(p3, file$f, 74, 6, 4720);
    			add_location(div4, file$f, 71, 4, 4486);
    			if (!src_url_equal(img4.src, img4_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133787941592907786/image.png?width=717&height=671")) attr_dev(img4, "src", img4_src_value);
    			set_style(img4, "border-radius", "10px");
    			set_style(img4, "width", "300px");
    			set_style(img4, "height", "320px");
    			add_location(img4, file$f, 78, 6, 4855);
    			attr_dev(p4, "id", "ped-name");
    			set_style(p4, "text-align", "center");
    			attr_dev(p4, "class", "svelte-1qp9z6g");
    			add_location(p4, file$f, 79, 6, 5045);
    			add_location(div5, file$f, 76, 4, 4789);
    			if (!src_url_equal(img5.src, img5_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133788147919110194/image.png")) attr_dev(img5, "src", img5_src_value);
    			set_style(img5, "border-radius", "10px");
    			set_style(img5, "width", "300px");
    			set_style(img5, "height", "320px");
    			add_location(img5, file$f, 83, 6, 5181);
    			attr_dev(p5, "id", "ped-name");
    			set_style(p5, "text-align", "center");
    			attr_dev(p5, "class", "svelte-1qp9z6g");
    			add_location(p5, file$f, 84, 6, 5349);
    			add_location(div6, file$f, 81, 4, 5115);
    			attr_dev(div7, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ;");
    			add_location(div7, file$f, 65, 2, 4073);
    			if (!src_url_equal(img6.src, img6_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133788434289401856/image.png")) attr_dev(img6, "src", img6_src_value);
    			set_style(img6, "border-radius", "10px");
    			set_style(img6, "width", "300px");
    			set_style(img6, "height", "320px");
    			add_location(img6, file$f, 91, 6, 5600);
    			attr_dev(p6, "id", "ped-name");
    			set_style(p6, "text-align", "center");
    			attr_dev(p6, "class", "svelte-1qp9z6g");
    			add_location(p6, file$f, 92, 6, 5768);
    			add_location(div8, file$f, 89, 4, 5534);
    			if (!src_url_equal(img7.src, img7_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134068255221366814/image.png")) attr_dev(img7, "src", img7_src_value);
    			set_style(img7, "border-radius", "10px");
    			set_style(img7, "width", "300px");
    			set_style(img7, "height", "320px");
    			add_location(img7, file$f, 96, 6, 5902);
    			attr_dev(p7, "id", "ped-name");
    			set_style(p7, "text-align", "center");
    			attr_dev(p7, "class", "svelte-1qp9z6g");
    			add_location(p7, file$f, 97, 6, 6070);
    			add_location(div9, file$f, 94, 4, 5836);
    			if (!src_url_equal(img8.src, img8_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133788701407858738/image.png")) attr_dev(img8, "src", img8_src_value);
    			set_style(img8, "border-radius", "10px");
    			set_style(img8, "width", "300px");
    			set_style(img8, "height", "320px");
    			add_location(img8, file$f, 101, 6, 6206);
    			attr_dev(p8, "id", "ped-name");
    			set_style(p8, "text-align", "center");
    			attr_dev(p8, "class", "svelte-1qp9z6g");
    			add_location(p8, file$f, 102, 6, 6374);
    			add_location(div10, file$f, 99, 4, 6140);
    			if (!src_url_equal(img9.src, img9_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133788879086964927/image.png")) attr_dev(img9, "src", img9_src_value);
    			set_style(img9, "border-radius", "10px");
    			set_style(img9, "width", "300px");
    			set_style(img9, "height", "320px");
    			add_location(img9, file$f, 106, 6, 6508);
    			attr_dev(p9, "id", "ped-name");
    			set_style(p9, "text-align", "center");
    			attr_dev(p9, "class", "svelte-1qp9z6g");
    			add_location(p9, file$f, 107, 6, 6676);
    			add_location(div11, file$f, 104, 4, 6442);
    			attr_dev(div12, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div12, file$f, 88, 2, 5429);
    			if (!src_url_equal(img10.src, img10_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133789305299533915/image.png?width=564&height=671")) attr_dev(img10, "src", img10_src_value);
    			set_style(img10, "border-radius", "10px");
    			set_style(img10, "width", "300px");
    			set_style(img10, "height", "320px");
    			add_location(img10, file$f, 114, 6, 6925);
    			attr_dev(p10, "id", "ped-name");
    			set_style(p10, "text-align", "center");
    			attr_dev(p10, "class", "svelte-1qp9z6g");
    			add_location(p10, file$f, 115, 6, 7114);
    			add_location(div13, file$f, 112, 4, 6859);
    			if (!src_url_equal(img11.src, img11_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133789421246873741/image.png")) attr_dev(img11, "src", img11_src_value);
    			set_style(img11, "border-radius", "10px");
    			set_style(img11, "width", "300px");
    			set_style(img11, "height", "320px");
    			add_location(img11, file$f, 119, 6, 7248);
    			attr_dev(p11, "id", "ped-name");
    			set_style(p11, "text-align", "center");
    			attr_dev(p11, "class", "svelte-1qp9z6g");
    			add_location(p11, file$f, 120, 6, 7416);
    			add_location(div14, file$f, 117, 4, 7182);
    			if (!src_url_equal(img12.src, img12_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134067955290869791/image.png")) attr_dev(img12, "src", img12_src_value);
    			set_style(img12, "border-radius", "10px");
    			set_style(img12, "width", "300px");
    			set_style(img12, "height", "320px");
    			add_location(img12, file$f, 124, 6, 7551);
    			attr_dev(p12, "id", "ped-name");
    			set_style(p12, "text-align", "center");
    			attr_dev(p12, "class", "svelte-1qp9z6g");
    			add_location(p12, file$f, 125, 6, 7719);
    			add_location(div15, file$f, 122, 4, 7485);
    			if (!src_url_equal(img13.src, img13_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133789563903557672/image.png?width=512&height=671")) attr_dev(img13, "src", img13_src_value);
    			set_style(img13, "border-radius", "10px");
    			set_style(img13, "width", "300px");
    			set_style(img13, "height", "320px");
    			add_location(img13, file$f, 129, 6, 7856);
    			attr_dev(p13, "id", "ped-name");
    			set_style(p13, "text-align", "center");
    			attr_dev(p13, "class", "svelte-1qp9z6g");
    			add_location(p13, file$f, 130, 6, 8045);
    			add_location(div16, file$f, 127, 4, 7790);
    			attr_dev(div17, "style", "display: flex; justify-content : space-around ; margin-top : 15px ;flex-wrap: wrap ;");
    			add_location(div17, file$f, 111, 2, 6755);
    			if (!src_url_equal(img14.src, img14_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133789664038367333/image.png")) attr_dev(img14, "src", img14_src_value);
    			set_style(img14, "border-radius", "10px");
    			set_style(img14, "width", "300px");
    			set_style(img14, "height", "320px");
    			add_location(img14, file$f, 137, 6, 8297);
    			attr_dev(p14, "id", "ped-name");
    			set_style(p14, "text-align", "center");
    			attr_dev(p14, "class", "svelte-1qp9z6g");
    			add_location(p14, file$f, 138, 6, 8465);
    			add_location(div18, file$f, 135, 4, 8229);
    			if (!src_url_equal(img15.src, img15_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133790796580134933/image.png")) attr_dev(img15, "src", img15_src_value);
    			set_style(img15, "border-radius", "10px");
    			set_style(img15, "width", "300px");
    			set_style(img15, "height", "320px");
    			add_location(img15, file$f, 142, 6, 8600);
    			attr_dev(p15, "id", "ped-name");
    			set_style(p15, "text-align", "center");
    			attr_dev(p15, "class", "svelte-1qp9z6g");
    			add_location(p15, file$f, 143, 6, 8768);
    			add_location(div19, file$f, 140, 4, 8534);
    			if (!src_url_equal(img16.src, img16_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133790967523201054/image.png?width=672&height=671")) attr_dev(img16, "src", img16_src_value);
    			set_style(img16, "border-radius", "10px");
    			set_style(img16, "width", "300px");
    			set_style(img16, "height", "320px");
    			add_location(img16, file$f, 147, 6, 8903);
    			attr_dev(p16, "id", "ped-name");
    			set_style(p16, "text-align", "center");
    			attr_dev(p16, "class", "svelte-1qp9z6g");
    			add_location(p16, file$f, 148, 6, 9092);
    			add_location(div20, file$f, 145, 4, 8837);
    			if (!src_url_equal(img17.src, img17_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133791198415442011/image.png")) attr_dev(img17, "src", img17_src_value);
    			set_style(img17, "border-radius", "10px");
    			set_style(img17, "width", "300px");
    			set_style(img17, "height", "320px");
    			add_location(img17, file$f, 152, 6, 9227);
    			attr_dev(p17, "id", "ped-name");
    			set_style(p17, "text-align", "center");
    			attr_dev(p17, "class", "svelte-1qp9z6g");
    			add_location(p17, file$f, 153, 6, 9395);
    			add_location(div21, file$f, 150, 4, 9161);
    			attr_dev(div22, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div22, file$f, 134, 2, 8124);
    			if (!src_url_equal(img18.src, img18_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133793138255863848/image.png")) attr_dev(img18, "src", img18_src_value);
    			set_style(img18, "border-radius", "10px");
    			set_style(img18, "width", "300px");
    			set_style(img18, "height", "320px");
    			add_location(img18, file$f, 160, 6, 9647);
    			attr_dev(p18, "id", "ped-name");
    			set_style(p18, "text-align", "center");
    			attr_dev(p18, "class", "svelte-1qp9z6g");
    			add_location(p18, file$f, 161, 6, 9815);
    			add_location(div23, file$f, 158, 4, 9579);
    			if (!src_url_equal(img19.src, img19_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133793238134829166/image.png")) attr_dev(img19, "src", img19_src_value);
    			set_style(img19, "border-radius", "10px");
    			set_style(img19, "width", "300px");
    			set_style(img19, "height", "320px");
    			add_location(img19, file$f, 165, 6, 9950);
    			attr_dev(p19, "id", "ped-name");
    			set_style(p19, "text-align", "center");
    			attr_dev(p19, "class", "svelte-1qp9z6g");
    			add_location(p19, file$f, 166, 6, 10118);
    			add_location(div24, file$f, 163, 4, 9884);
    			if (!src_url_equal(img20.src, img20_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133793335136493758/image.png")) attr_dev(img20, "src", img20_src_value);
    			set_style(img20, "border-radius", "10px");
    			set_style(img20, "width", "300px");
    			set_style(img20, "height", "320px");
    			add_location(img20, file$f, 170, 6, 10253);
    			attr_dev(p20, "id", "ped-name");
    			set_style(p20, "text-align", "center");
    			attr_dev(p20, "class", "svelte-1qp9z6g");
    			add_location(p20, file$f, 171, 6, 10421);
    			add_location(div25, file$f, 168, 4, 10187);
    			if (!src_url_equal(img21.src, img21_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133793492804587560/image.png?width=584&height=670")) attr_dev(img21, "src", img21_src_value);
    			set_style(img21, "border-radius", "10px");
    			set_style(img21, "width", "300px");
    			set_style(img21, "height", "320px");
    			add_location(img21, file$f, 175, 6, 10556);
    			attr_dev(p21, "id", "ped-name");
    			set_style(p21, "text-align", "center");
    			attr_dev(p21, "class", "svelte-1qp9z6g");
    			add_location(p21, file$f, 176, 6, 10745);
    			add_location(div26, file$f, 173, 4, 10490);
    			attr_dev(div27, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div27, file$f, 157, 2, 9474);
    			if (!src_url_equal(img22.src, img22_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133793657846235166/image.png")) attr_dev(img22, "src", img22_src_value);
    			set_style(img22, "border-radius", "10px");
    			set_style(img22, "width", "300px");
    			set_style(img22, "height", "320px");
    			add_location(img22, file$f, 183, 6, 10997);
    			attr_dev(p22, "id", "ped-name");
    			set_style(p22, "text-align", "center");
    			attr_dev(p22, "class", "svelte-1qp9z6g");
    			add_location(p22, file$f, 184, 6, 11165);
    			add_location(div28, file$f, 181, 4, 10929);
    			if (!src_url_equal(img23.src, img23_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133793776352120922/image.png")) attr_dev(img23, "src", img23_src_value);
    			set_style(img23, "border-radius", "10px");
    			set_style(img23, "width", "300px");
    			set_style(img23, "height", "320px");
    			add_location(img23, file$f, 188, 6, 11300);
    			attr_dev(p23, "id", "ped-name");
    			set_style(p23, "text-align", "center");
    			attr_dev(p23, "class", "svelte-1qp9z6g");
    			add_location(p23, file$f, 189, 6, 11468);
    			add_location(div29, file$f, 186, 4, 11234);
    			if (!src_url_equal(img24.src, img24_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133793897450066070/image.png")) attr_dev(img24, "src", img24_src_value);
    			set_style(img24, "border-radius", "10px");
    			set_style(img24, "width", "300px");
    			set_style(img24, "height", "320px");
    			add_location(img24, file$f, 193, 6, 11603);
    			attr_dev(p24, "id", "ped-name");
    			set_style(p24, "text-align", "center");
    			attr_dev(p24, "class", "svelte-1qp9z6g");
    			add_location(p24, file$f, 194, 6, 11771);
    			add_location(div30, file$f, 191, 4, 11537);
    			if (!src_url_equal(img25.src, img25_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133794124030541966/image.png")) attr_dev(img25, "src", img25_src_value);
    			set_style(img25, "border-radius", "10px");
    			set_style(img25, "width", "300px");
    			set_style(img25, "height", "320px");
    			add_location(img25, file$f, 198, 6, 11906);
    			attr_dev(p25, "id", "ped-name");
    			set_style(p25, "text-align", "center");
    			attr_dev(p25, "class", "svelte-1qp9z6g");
    			add_location(p25, file$f, 199, 6, 12074);
    			add_location(div31, file$f, 196, 4, 11840);
    			attr_dev(div32, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div32, file$f, 180, 2, 10824);
    			if (!src_url_equal(img26.src, img26_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133794330260283412/image.png")) attr_dev(img26, "src", img26_src_value);
    			set_style(img26, "border-radius", "10px");
    			set_style(img26, "width", "300px");
    			set_style(img26, "height", "320px");
    			add_location(img26, file$f, 206, 6, 12326);
    			attr_dev(p26, "id", "ped-name");
    			set_style(p26, "text-align", "center");
    			attr_dev(p26, "class", "svelte-1qp9z6g");
    			add_location(p26, file$f, 207, 6, 12494);
    			add_location(div33, file$f, 204, 4, 12258);
    			if (!src_url_equal(img27.src, img27_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133794430801944657/image.png")) attr_dev(img27, "src", img27_src_value);
    			set_style(img27, "border-radius", "10px");
    			set_style(img27, "width", "300px");
    			set_style(img27, "height", "320px");
    			add_location(img27, file$f, 211, 6, 12629);
    			attr_dev(p27, "id", "ped-name");
    			set_style(p27, "text-align", "center");
    			attr_dev(p27, "class", "svelte-1qp9z6g");
    			add_location(p27, file$f, 212, 6, 12797);
    			add_location(div34, file$f, 209, 4, 12563);
    			if (!src_url_equal(img28.src, img28_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133794582279241808/image.png?width=638&height=671")) attr_dev(img28, "src", img28_src_value);
    			set_style(img28, "border-radius", "10px");
    			set_style(img28, "width", "300px");
    			set_style(img28, "height", "320px");
    			add_location(img28, file$f, 216, 6, 12932);
    			attr_dev(p28, "id", "ped-name");
    			set_style(p28, "text-align", "center");
    			attr_dev(p28, "class", "svelte-1qp9z6g");
    			add_location(p28, file$f, 217, 6, 13121);
    			add_location(div35, file$f, 214, 4, 12866);
    			if (!src_url_equal(img29.src, img29_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133794807437873292/image.png")) attr_dev(img29, "src", img29_src_value);
    			set_style(img29, "border-radius", "10px");
    			set_style(img29, "width", "300px");
    			set_style(img29, "height", "320px");
    			add_location(img29, file$f, 221, 6, 13256);
    			attr_dev(p29, "id", "ped-name");
    			set_style(p29, "text-align", "center");
    			attr_dev(p29, "class", "svelte-1qp9z6g");
    			add_location(p29, file$f, 222, 6, 13424);
    			add_location(div36, file$f, 219, 4, 13190);
    			attr_dev(div37, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div37, file$f, 203, 2, 12153);
    			if (!src_url_equal(img30.src, img30_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133794978338983976/image.png")) attr_dev(img30, "src", img30_src_value);
    			set_style(img30, "border-radius", "10px");
    			set_style(img30, "width", "300px");
    			set_style(img30, "height", "320px");
    			add_location(img30, file$f, 229, 6, 13676);
    			attr_dev(p30, "id", "ped-name");
    			set_style(p30, "text-align", "center");
    			attr_dev(p30, "class", "svelte-1qp9z6g");
    			add_location(p30, file$f, 230, 6, 13844);
    			add_location(div38, file$f, 227, 4, 13608);
    			if (!src_url_equal(img31.src, img31_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133795134631321690/image.png")) attr_dev(img31, "src", img31_src_value);
    			set_style(img31, "border-radius", "10px");
    			set_style(img31, "width", "300px");
    			set_style(img31, "height", "320px");
    			add_location(img31, file$f, 234, 6, 13979);
    			attr_dev(p31, "id", "ped-name");
    			set_style(p31, "text-align", "center");
    			attr_dev(p31, "class", "svelte-1qp9z6g");
    			add_location(p31, file$f, 235, 6, 14147);
    			add_location(div39, file$f, 232, 4, 13913);
    			if (!src_url_equal(img32.src, img32_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133795436059181076/image.png")) attr_dev(img32, "src", img32_src_value);
    			set_style(img32, "border-radius", "10px");
    			set_style(img32, "width", "300px");
    			set_style(img32, "height", "320px");
    			add_location(img32, file$f, 239, 6, 14282);
    			attr_dev(p32, "id", "ped-name");
    			set_style(p32, "text-align", "center");
    			attr_dev(p32, "class", "svelte-1qp9z6g");
    			add_location(p32, file$f, 240, 6, 14450);
    			add_location(div40, file$f, 237, 4, 14216);
    			if (!src_url_equal(img33.src, img33_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133795529780908062/image.png")) attr_dev(img33, "src", img33_src_value);
    			set_style(img33, "border-radius", "10px");
    			set_style(img33, "width", "300px");
    			set_style(img33, "height", "320px");
    			add_location(img33, file$f, 244, 6, 14585);
    			attr_dev(p33, "id", "ped-name");
    			set_style(p33, "text-align", "center");
    			attr_dev(p33, "class", "svelte-1qp9z6g");
    			add_location(p33, file$f, 245, 6, 14753);
    			add_location(div41, file$f, 242, 4, 14519);
    			attr_dev(div42, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div42, file$f, 226, 2, 13503);
    			if (!src_url_equal(img34.src, img34_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133795618121326713/image.png")) attr_dev(img34, "src", img34_src_value);
    			set_style(img34, "border-radius", "10px");
    			set_style(img34, "width", "300px");
    			set_style(img34, "height", "320px");
    			add_location(img34, file$f, 252, 6, 15005);
    			attr_dev(p34, "id", "ped-name");
    			set_style(p34, "text-align", "center");
    			attr_dev(p34, "class", "svelte-1qp9z6g");
    			add_location(p34, file$f, 253, 6, 15173);
    			add_location(div43, file$f, 250, 4, 14937);
    			if (!src_url_equal(img35.src, img35_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133795717190799431/image.png")) attr_dev(img35, "src", img35_src_value);
    			set_style(img35, "border-radius", "10px");
    			set_style(img35, "width", "300px");
    			set_style(img35, "height", "320px");
    			add_location(img35, file$f, 257, 6, 15308);
    			attr_dev(p35, "id", "ped-name");
    			set_style(p35, "text-align", "center");
    			attr_dev(p35, "class", "svelte-1qp9z6g");
    			add_location(p35, file$f, 258, 6, 15476);
    			add_location(div44, file$f, 255, 4, 15242);
    			if (!src_url_equal(img36.src, img36_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133795790997958808/image.png")) attr_dev(img36, "src", img36_src_value);
    			set_style(img36, "border-radius", "10px");
    			set_style(img36, "width", "300px");
    			set_style(img36, "height", "320px");
    			add_location(img36, file$f, 262, 6, 15611);
    			attr_dev(p36, "id", "ped-name");
    			set_style(p36, "text-align", "center");
    			attr_dev(p36, "class", "svelte-1qp9z6g");
    			add_location(p36, file$f, 263, 6, 15779);
    			add_location(div45, file$f, 260, 4, 15545);
    			if (!src_url_equal(img37.src, img37_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133795864117268580/image.png")) attr_dev(img37, "src", img37_src_value);
    			set_style(img37, "border-radius", "10px");
    			set_style(img37, "width", "300px");
    			set_style(img37, "height", "320px");
    			add_location(img37, file$f, 267, 6, 15914);
    			attr_dev(p37, "id", "ped-name");
    			set_style(p37, "text-align", "center");
    			attr_dev(p37, "class", "svelte-1qp9z6g");
    			add_location(p37, file$f, 268, 6, 16082);
    			add_location(div46, file$f, 265, 4, 15848);
    			attr_dev(div47, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div47, file$f, 249, 2, 14832);
    			if (!src_url_equal(img38.src, img38_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133796064449798255/image.png")) attr_dev(img38, "src", img38_src_value);
    			set_style(img38, "border-radius", "10px");
    			set_style(img38, "width", "300px");
    			set_style(img38, "height", "320px");
    			add_location(img38, file$f, 276, 6, 16334);
    			attr_dev(p38, "id", "ped-name");
    			set_style(p38, "text-align", "center");
    			attr_dev(p38, "class", "svelte-1qp9z6g");
    			add_location(p38, file$f, 277, 6, 16502);
    			add_location(div48, file$f, 274, 4, 16268);
    			if (!src_url_equal(img39.src, img39_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133796137787199498/image.png")) attr_dev(img39, "src", img39_src_value);
    			set_style(img39, "border-radius", "10px");
    			set_style(img39, "width", "300px");
    			set_style(img39, "height", "320px");
    			add_location(img39, file$f, 281, 6, 16638);
    			attr_dev(p39, "id", "ped-name");
    			set_style(p39, "text-align", "center");
    			attr_dev(p39, "class", "svelte-1qp9z6g");
    			add_location(p39, file$f, 282, 6, 16806);
    			add_location(div49, file$f, 279, 4, 16572);
    			if (!src_url_equal(img40.src, img40_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133796376292110366/image.png?width=559&height=671")) attr_dev(img40, "src", img40_src_value);
    			set_style(img40, "border-radius", "10px");
    			set_style(img40, "width", "300px");
    			set_style(img40, "height", "320px");
    			add_location(img40, file$f, 286, 6, 16941);
    			attr_dev(p40, "id", "ped-name");
    			set_style(p40, "text-align", "center");
    			attr_dev(p40, "class", "svelte-1qp9z6g");
    			add_location(p40, file$f, 287, 6, 17130);
    			add_location(div50, file$f, 284, 4, 16875);
    			if (!src_url_equal(img41.src, img41_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133796471389569147/image.png")) attr_dev(img41, "src", img41_src_value);
    			set_style(img41, "border-radius", "10px");
    			set_style(img41, "width", "300px");
    			set_style(img41, "height", "320px");
    			add_location(img41, file$f, 291, 6, 17265);
    			attr_dev(p41, "id", "ped-name");
    			set_style(p41, "text-align", "center");
    			attr_dev(p41, "class", "svelte-1qp9z6g");
    			add_location(p41, file$f, 292, 6, 17433);
    			add_location(div51, file$f, 289, 4, 17199);
    			attr_dev(div52, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div52, file$f, 273, 2, 16163);
    			if (!src_url_equal(img42.src, img42_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133796576440094810/image.png")) attr_dev(img42, "src", img42_src_value);
    			set_style(img42, "border-radius", "10px");
    			set_style(img42, "width", "300px");
    			set_style(img42, "height", "320px");
    			add_location(img42, file$f, 299, 6, 17685);
    			attr_dev(p42, "id", "ped-name");
    			set_style(p42, "text-align", "center");
    			attr_dev(p42, "class", "svelte-1qp9z6g");
    			add_location(p42, file$f, 300, 6, 17853);
    			add_location(div53, file$f, 297, 4, 17617);
    			if (!src_url_equal(img43.src, img43_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133796666537951263/image.png")) attr_dev(img43, "src", img43_src_value);
    			set_style(img43, "border-radius", "10px");
    			set_style(img43, "width", "300px");
    			set_style(img43, "height", "320px");
    			add_location(img43, file$f, 304, 6, 17988);
    			attr_dev(p43, "id", "ped-name");
    			set_style(p43, "text-align", "center");
    			attr_dev(p43, "class", "svelte-1qp9z6g");
    			add_location(p43, file$f, 305, 6, 18156);
    			add_location(div54, file$f, 302, 4, 17922);
    			if (!src_url_equal(img44.src, img44_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133796760754597939/image.png")) attr_dev(img44, "src", img44_src_value);
    			set_style(img44, "border-radius", "10px");
    			set_style(img44, "width", "300px");
    			set_style(img44, "height", "320px");
    			add_location(img44, file$f, 309, 6, 18292);
    			attr_dev(p44, "id", "ped-name");
    			set_style(p44, "text-align", "center");
    			attr_dev(p44, "class", "svelte-1qp9z6g");
    			add_location(p44, file$f, 310, 6, 18460);
    			add_location(div55, file$f, 307, 4, 18226);
    			if (!src_url_equal(img45.src, img45_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133797053470867536/image.png?width=501&height=671")) attr_dev(img45, "src", img45_src_value);
    			set_style(img45, "border-radius", "10px");
    			set_style(img45, "width", "300px");
    			set_style(img45, "height", "320px");
    			add_location(img45, file$f, 314, 6, 18595);
    			attr_dev(p45, "id", "ped-name");
    			set_style(p45, "text-align", "center");
    			attr_dev(p45, "class", "svelte-1qp9z6g");
    			add_location(p45, file$f, 315, 6, 18784);
    			add_location(div56, file$f, 312, 4, 18529);
    			attr_dev(div57, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div57, file$f, 296, 2, 17512);
    			if (!src_url_equal(img46.src, img46_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133797219976351954/image.png?width=592&height=671")) attr_dev(img46, "src", img46_src_value);
    			set_style(img46, "border-radius", "10px");
    			set_style(img46, "width", "300px");
    			set_style(img46, "height", "320px");
    			add_location(img46, file$f, 322, 6, 19036);
    			attr_dev(p46, "id", "ped-name");
    			set_style(p46, "text-align", "center");
    			attr_dev(p46, "class", "svelte-1qp9z6g");
    			add_location(p46, file$f, 323, 6, 19225);
    			add_location(div58, file$f, 320, 4, 18968);
    			if (!src_url_equal(img47.src, img47_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134067422505205822/image.png")) attr_dev(img47, "src", img47_src_value);
    			set_style(img47, "border-radius", "10px");
    			set_style(img47, "width", "300px");
    			set_style(img47, "height", "320px");
    			add_location(img47, file$f, 327, 6, 19360);
    			attr_dev(p47, "id", "ped-name");
    			set_style(p47, "text-align", "center");
    			attr_dev(p47, "class", "svelte-1qp9z6g");
    			add_location(p47, file$f, 328, 6, 19528);
    			add_location(div59, file$f, 325, 4, 19294);
    			if (!src_url_equal(img48.src, img48_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134066993289502730/image.png")) attr_dev(img48, "src", img48_src_value);
    			set_style(img48, "border-radius", "10px");
    			set_style(img48, "width", "300px");
    			set_style(img48, "height", "320px");
    			add_location(img48, file$f, 332, 6, 19663);
    			attr_dev(p48, "id", "ped-name");
    			set_style(p48, "text-align", "center");
    			attr_dev(p48, "class", "svelte-1qp9z6g");
    			add_location(p48, file$f, 333, 6, 19831);
    			add_location(div60, file$f, 330, 4, 19597);
    			if (!src_url_equal(img49.src, img49_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133797546746191984/image.png?width=541&height=671")) attr_dev(img49, "src", img49_src_value);
    			set_style(img49, "border-radius", "10px");
    			set_style(img49, "width", "300px");
    			set_style(img49, "height", "320px");
    			add_location(img49, file$f, 337, 6, 19970);
    			attr_dev(p49, "id", "ped-name");
    			set_style(p49, "text-align", "center");
    			attr_dev(p49, "class", "svelte-1qp9z6g");
    			add_location(p49, file$f, 338, 6, 20159);
    			add_location(div61, file$f, 335, 4, 19904);
    			attr_dev(div62, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div62, file$f, 319, 2, 18863);
    			if (!src_url_equal(img50.src, img50_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133797703994835045/image.png")) attr_dev(img50, "src", img50_src_value);
    			set_style(img50, "border-radius", "10px");
    			set_style(img50, "width", "300px");
    			set_style(img50, "height", "320px");
    			add_location(img50, file$f, 345, 6, 20411);
    			attr_dev(p50, "id", "ped-name");
    			set_style(p50, "text-align", "center");
    			attr_dev(p50, "class", "svelte-1qp9z6g");
    			add_location(p50, file$f, 346, 6, 20579);
    			add_location(div63, file$f, 343, 4, 20343);
    			if (!src_url_equal(img51.src, img51_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133797973592113262/image.png?width=558&height=671")) attr_dev(img51, "src", img51_src_value);
    			set_style(img51, "border-radius", "10px");
    			set_style(img51, "width", "300px");
    			set_style(img51, "height", "320px");
    			add_location(img51, file$f, 350, 6, 20714);
    			attr_dev(p51, "id", "ped-name");
    			set_style(p51, "text-align", "center");
    			attr_dev(p51, "class", "svelte-1qp9z6g");
    			add_location(p51, file$f, 351, 6, 20903);
    			add_location(div64, file$f, 348, 4, 20648);
    			if (!src_url_equal(img52.src, img52_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133797978696593519/image.png")) attr_dev(img52, "src", img52_src_value);
    			set_style(img52, "border-radius", "10px");
    			set_style(img52, "width", "300px");
    			set_style(img52, "height", "320px");
    			add_location(img52, file$f, 355, 6, 21038);
    			attr_dev(p52, "id", "ped-name");
    			set_style(p52, "text-align", "center");
    			attr_dev(p52, "class", "svelte-1qp9z6g");
    			add_location(p52, file$f, 356, 6, 21206);
    			add_location(div65, file$f, 353, 4, 20972);
    			if (!src_url_equal(img53.src, img53_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133798089875005440/image.png")) attr_dev(img53, "src", img53_src_value);
    			set_style(img53, "border-radius", "10px");
    			set_style(img53, "width", "300px");
    			set_style(img53, "height", "320px");
    			add_location(img53, file$f, 360, 6, 21341);
    			attr_dev(p53, "id", "ped-name");
    			set_style(p53, "text-align", "center");
    			attr_dev(p53, "class", "svelte-1qp9z6g");
    			add_location(p53, file$f, 361, 6, 21509);
    			add_location(div66, file$f, 358, 4, 21275);
    			attr_dev(div67, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div67, file$f, 342, 2, 20238);
    			if (!src_url_equal(img54.src, img54_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133798331253002432/image.png")) attr_dev(img54, "src", img54_src_value);
    			set_style(img54, "border-radius", "10px");
    			set_style(img54, "width", "300px");
    			set_style(img54, "height", "320px");
    			add_location(img54, file$f, 368, 6, 21762);
    			attr_dev(p54, "id", "ped-name");
    			set_style(p54, "text-align", "center");
    			attr_dev(p54, "class", "svelte-1qp9z6g");
    			add_location(p54, file$f, 369, 6, 21930);
    			add_location(div68, file$f, 366, 4, 21694);
    			if (!src_url_equal(img55.src, img55_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133798637089079296/image.png")) attr_dev(img55, "src", img55_src_value);
    			set_style(img55, "border-radius", "10px");
    			set_style(img55, "width", "300px");
    			set_style(img55, "height", "320px");
    			add_location(img55, file$f, 373, 6, 22065);
    			attr_dev(p55, "id", "ped-name");
    			set_style(p55, "text-align", "center");
    			attr_dev(p55, "class", "svelte-1qp9z6g");
    			add_location(p55, file$f, 374, 6, 22233);
    			add_location(div69, file$f, 371, 4, 21999);
    			if (!src_url_equal(img56.src, img56_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133798893432356985/image.png")) attr_dev(img56, "src", img56_src_value);
    			set_style(img56, "border-radius", "10px");
    			set_style(img56, "width", "300px");
    			set_style(img56, "height", "320px");
    			add_location(img56, file$f, 378, 6, 22369);
    			attr_dev(p56, "id", "ped-name");
    			set_style(p56, "text-align", "center");
    			attr_dev(p56, "class", "svelte-1qp9z6g");
    			add_location(p56, file$f, 379, 6, 22537);
    			add_location(div70, file$f, 376, 4, 22303);
    			if (!src_url_equal(img57.src, img57_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133798979717566514/image.png")) attr_dev(img57, "src", img57_src_value);
    			set_style(img57, "border-radius", "10px");
    			set_style(img57, "width", "300px");
    			set_style(img57, "height", "320px");
    			add_location(img57, file$f, 383, 6, 22672);
    			attr_dev(p57, "id", "ped-name");
    			set_style(p57, "text-align", "center");
    			attr_dev(p57, "class", "svelte-1qp9z6g");
    			add_location(p57, file$f, 384, 6, 22840);
    			add_location(div71, file$f, 381, 4, 22606);
    			attr_dev(div72, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div72, file$f, 365, 2, 21589);
    			if (!src_url_equal(img58.src, img58_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133799076987670658/image.png")) attr_dev(img58, "src", img58_src_value);
    			set_style(img58, "border-radius", "10px");
    			set_style(img58, "width", "300px");
    			set_style(img58, "height", "320px");
    			add_location(img58, file$f, 391, 6, 23092);
    			attr_dev(p58, "id", "ped-name");
    			set_style(p58, "text-align", "center");
    			attr_dev(p58, "class", "svelte-1qp9z6g");
    			add_location(p58, file$f, 392, 6, 23260);
    			add_location(div73, file$f, 389, 4, 23024);
    			if (!src_url_equal(img59.src, img59_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133799217010327592/image.png")) attr_dev(img59, "src", img59_src_value);
    			set_style(img59, "border-radius", "10px");
    			set_style(img59, "width", "300px");
    			set_style(img59, "height", "320px");
    			add_location(img59, file$f, 396, 6, 23395);
    			attr_dev(p59, "id", "ped-name");
    			set_style(p59, "text-align", "center");
    			attr_dev(p59, "class", "svelte-1qp9z6g");
    			add_location(p59, file$f, 397, 6, 23563);
    			add_location(div74, file$f, 394, 4, 23329);
    			if (!src_url_equal(img60.src, img60_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134066760853766197/image.png")) attr_dev(img60, "src", img60_src_value);
    			set_style(img60, "border-radius", "10px");
    			set_style(img60, "width", "300px");
    			set_style(img60, "height", "320px");
    			add_location(img60, file$f, 401, 6, 23698);
    			attr_dev(p60, "id", "ped-name");
    			set_style(p60, "text-align", "center");
    			attr_dev(p60, "class", "svelte-1qp9z6g");
    			add_location(p60, file$f, 402, 6, 23866);
    			add_location(div75, file$f, 399, 4, 23632);
    			if (!src_url_equal(img61.src, img61_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133799321070997504/image.png")) attr_dev(img61, "src", img61_src_value);
    			set_style(img61, "border-radius", "10px");
    			set_style(img61, "width", "300px");
    			set_style(img61, "height", "320px");
    			add_location(img61, file$f, 406, 6, 24005);
    			attr_dev(p61, "id", "ped-name");
    			set_style(p61, "text-align", "center");
    			attr_dev(p61, "class", "svelte-1qp9z6g");
    			add_location(p61, file$f, 407, 6, 24173);
    			add_location(div76, file$f, 404, 4, 23939);
    			attr_dev(div77, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div77, file$f, 388, 2, 22919);
    			if (!src_url_equal(img62.src, img62_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133799451224461322/image.png")) attr_dev(img62, "src", img62_src_value);
    			set_style(img62, "border-radius", "10px");
    			set_style(img62, "width", "300px");
    			set_style(img62, "height", "320px");
    			add_location(img62, file$f, 415, 6, 24425);
    			attr_dev(p62, "id", "ped-name");
    			set_style(p62, "text-align", "center");
    			attr_dev(p62, "class", "svelte-1qp9z6g");
    			add_location(p62, file$f, 416, 6, 24593);
    			add_location(div78, file$f, 413, 4, 24359);
    			if (!src_url_equal(img63.src, img63_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133799457775947980/image.png")) attr_dev(img63, "src", img63_src_value);
    			set_style(img63, "border-radius", "10px");
    			set_style(img63, "width", "300px");
    			set_style(img63, "height", "320px");
    			add_location(img63, file$f, 420, 6, 24728);
    			attr_dev(p63, "id", "ped-name");
    			set_style(p63, "text-align", "center");
    			attr_dev(p63, "class", "svelte-1qp9z6g");
    			add_location(p63, file$f, 421, 6, 24896);
    			add_location(div79, file$f, 418, 4, 24662);
    			if (!src_url_equal(img64.src, img64_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133799713301340160/image.png")) attr_dev(img64, "src", img64_src_value);
    			set_style(img64, "border-radius", "10px");
    			set_style(img64, "width", "300px");
    			set_style(img64, "height", "320px");
    			add_location(img64, file$f, 425, 6, 25031);
    			attr_dev(p64, "id", "ped-name");
    			set_style(p64, "text-align", "center");
    			attr_dev(p64, "class", "svelte-1qp9z6g");
    			add_location(p64, file$f, 426, 6, 25199);
    			add_location(div80, file$f, 423, 4, 24965);
    			if (!src_url_equal(img65.src, img65_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800020106289253/image.png")) attr_dev(img65, "src", img65_src_value);
    			set_style(img65, "border-radius", "10px");
    			set_style(img65, "width", "300px");
    			set_style(img65, "height", "320px");
    			add_location(img65, file$f, 430, 6, 25334);
    			attr_dev(p65, "id", "ped-name");
    			set_style(p65, "text-align", "center");
    			attr_dev(p65, "class", "svelte-1qp9z6g");
    			add_location(p65, file$f, 431, 6, 25502);
    			add_location(div81, file$f, 428, 4, 25268);
    			attr_dev(div82, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div82, file$f, 412, 2, 24254);
    			if (!src_url_equal(img66.src, img66_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800101056356362/image.png")) attr_dev(img66, "src", img66_src_value);
    			set_style(img66, "border-radius", "10px");
    			set_style(img66, "width", "300px");
    			set_style(img66, "height", "320px");
    			add_location(img66, file$f, 438, 6, 25756);
    			attr_dev(p66, "id", "ped-name");
    			set_style(p66, "text-align", "center");
    			attr_dev(p66, "class", "svelte-1qp9z6g");
    			add_location(p66, file$f, 439, 6, 25924);
    			add_location(div83, file$f, 436, 4, 25688);
    			if (!src_url_equal(img67.src, img67_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800472088694888/image.png")) attr_dev(img67, "src", img67_src_value);
    			set_style(img67, "border-radius", "10px");
    			set_style(img67, "width", "300px");
    			set_style(img67, "height", "320px");
    			add_location(img67, file$f, 443, 6, 26061);
    			attr_dev(p67, "id", "ped-name");
    			set_style(p67, "text-align", "center");
    			attr_dev(p67, "class", "svelte-1qp9z6g");
    			add_location(p67, file$f, 444, 6, 26229);
    			add_location(div84, file$f, 441, 4, 25995);
    			if (!src_url_equal(img68.src, img68_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800550580899891/image.png")) attr_dev(img68, "src", img68_src_value);
    			set_style(img68, "border-radius", "10px");
    			set_style(img68, "width", "300px");
    			set_style(img68, "height", "320px");
    			add_location(img68, file$f, 448, 6, 26364);
    			attr_dev(p68, "id", "ped-name");
    			set_style(p68, "text-align", "center");
    			attr_dev(p68, "class", "svelte-1qp9z6g");
    			add_location(p68, file$f, 449, 6, 26532);
    			add_location(div85, file$f, 446, 4, 26298);
    			if (!src_url_equal(img69.src, img69_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800668570861668/image.png")) attr_dev(img69, "src", img69_src_value);
    			set_style(img69, "border-radius", "10px");
    			set_style(img69, "width", "300px");
    			set_style(img69, "height", "320px");
    			add_location(img69, file$f, 453, 6, 26667);
    			attr_dev(p69, "id", "ped-name");
    			set_style(p69, "text-align", "center");
    			attr_dev(p69, "class", "svelte-1qp9z6g");
    			add_location(p69, file$f, 454, 6, 26835);
    			add_location(div86, file$f, 451, 4, 26601);
    			attr_dev(div87, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div87, file$f, 435, 2, 25583);
    			if (!src_url_equal(img70.src, img70_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800781456363620/image.png")) attr_dev(img70, "src", img70_src_value);
    			set_style(img70, "border-radius", "10px");
    			set_style(img70, "width", "300px");
    			set_style(img70, "height", "320px");
    			add_location(img70, file$f, 461, 6, 27087);
    			attr_dev(p70, "id", "ped-name");
    			set_style(p70, "text-align", "center");
    			attr_dev(p70, "class", "svelte-1qp9z6g");
    			add_location(p70, file$f, 462, 6, 27255);
    			add_location(div88, file$f, 459, 4, 27019);
    			if (!src_url_equal(img71.src, img71_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800848204509304/image.png")) attr_dev(img71, "src", img71_src_value);
    			set_style(img71, "border-radius", "10px");
    			set_style(img71, "width", "300px");
    			set_style(img71, "height", "320px");
    			add_location(img71, file$f, 466, 6, 27390);
    			attr_dev(p71, "id", "ped-name");
    			set_style(p71, "text-align", "center");
    			attr_dev(p71, "class", "svelte-1qp9z6g");
    			add_location(p71, file$f, 467, 6, 27558);
    			add_location(div89, file$f, 464, 4, 27324);
    			if (!src_url_equal(img72.src, img72_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133800923404193934/image.png")) attr_dev(img72, "src", img72_src_value);
    			set_style(img72, "border-radius", "10px");
    			set_style(img72, "width", "300px");
    			set_style(img72, "height", "320px");
    			add_location(img72, file$f, 471, 6, 27693);
    			attr_dev(p72, "id", "ped-name");
    			set_style(p72, "text-align", "center");
    			attr_dev(p72, "class", "svelte-1qp9z6g");
    			add_location(p72, file$f, 472, 6, 27861);
    			add_location(div90, file$f, 469, 4, 27627);
    			if (!src_url_equal(img73.src, img73_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133801009156718714/image.png")) attr_dev(img73, "src", img73_src_value);
    			set_style(img73, "border-radius", "10px");
    			set_style(img73, "width", "300px");
    			set_style(img73, "height", "320px");
    			add_location(img73, file$f, 476, 6, 27996);
    			attr_dev(p73, "id", "ped-name");
    			set_style(p73, "text-align", "center");
    			attr_dev(p73, "class", "svelte-1qp9z6g");
    			add_location(p73, file$f, 477, 6, 28164);
    			add_location(div91, file$f, 474, 4, 27930);
    			attr_dev(div92, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div92, file$f, 458, 2, 26914);
    			if (!src_url_equal(img74.src, img74_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133801148252442746/image.png")) attr_dev(img74, "src", img74_src_value);
    			set_style(img74, "border-radius", "10px");
    			set_style(img74, "width", "300px");
    			set_style(img74, "height", "320px");
    			add_location(img74, file$f, 484, 6, 28416);
    			attr_dev(p74, "id", "ped-name");
    			set_style(p74, "text-align", "center");
    			attr_dev(p74, "class", "svelte-1qp9z6g");
    			add_location(p74, file$f, 485, 6, 28584);
    			add_location(div93, file$f, 482, 4, 28348);
    			if (!src_url_equal(img75.src, img75_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134069324882133032/image.png")) attr_dev(img75, "src", img75_src_value);
    			set_style(img75, "border-radius", "10px");
    			set_style(img75, "width", "300px");
    			set_style(img75, "height", "320px");
    			add_location(img75, file$f, 489, 6, 28719);
    			attr_dev(p75, "id", "ped-name");
    			set_style(p75, "text-align", "center");
    			attr_dev(p75, "class", "svelte-1qp9z6g");
    			add_location(p75, file$f, 490, 6, 28887);
    			add_location(div94, file$f, 487, 4, 28653);
    			if (!src_url_equal(img76.src, img76_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133801240397090886/image.png")) attr_dev(img76, "src", img76_src_value);
    			set_style(img76, "border-radius", "10px");
    			set_style(img76, "width", "300px");
    			set_style(img76, "height", "320px");
    			add_location(img76, file$f, 494, 6, 29022);
    			attr_dev(p76, "id", "ped-name");
    			set_style(p76, "text-align", "center");
    			attr_dev(p76, "class", "svelte-1qp9z6g");
    			add_location(p76, file$f, 495, 6, 29190);
    			add_location(div95, file$f, 492, 4, 28956);
    			if (!src_url_equal(img77.src, img77_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133801386295967875/image.png")) attr_dev(img77, "src", img77_src_value);
    			set_style(img77, "border-radius", "10px");
    			set_style(img77, "width", "300px");
    			set_style(img77, "height", "320px");
    			add_location(img77, file$f, 499, 6, 29325);
    			attr_dev(p77, "id", "ped-name");
    			set_style(p77, "text-align", "center");
    			attr_dev(p77, "class", "svelte-1qp9z6g");
    			add_location(p77, file$f, 500, 6, 29493);
    			add_location(div96, file$f, 497, 4, 29259);
    			attr_dev(div97, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div97, file$f, 481, 2, 28243);
    			if (!src_url_equal(img78.src, img78_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133801679041609769/image.png")) attr_dev(img78, "src", img78_src_value);
    			set_style(img78, "border-radius", "10px");
    			set_style(img78, "width", "300px");
    			set_style(img78, "height", "320px");
    			add_location(img78, file$f, 508, 6, 29747);
    			attr_dev(p78, "id", "ped-name");
    			set_style(p78, "text-align", "center");
    			attr_dev(p78, "class", "svelte-1qp9z6g");
    			add_location(p78, file$f, 509, 6, 29915);
    			add_location(div98, file$f, 506, 4, 29679);
    			if (!src_url_equal(img79.src, img79_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133801927344398407/image.png")) attr_dev(img79, "src", img79_src_value);
    			set_style(img79, "border-radius", "10px");
    			set_style(img79, "width", "300px");
    			set_style(img79, "height", "320px");
    			add_location(img79, file$f, 513, 6, 30050);
    			attr_dev(p79, "id", "ped-name");
    			set_style(p79, "text-align", "center");
    			attr_dev(p79, "class", "svelte-1qp9z6g");
    			add_location(p79, file$f, 514, 6, 30218);
    			add_location(div99, file$f, 511, 4, 29984);
    			if (!src_url_equal(img80.src, img80_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133802254315556886/image.png")) attr_dev(img80, "src", img80_src_value);
    			set_style(img80, "border-radius", "10px");
    			set_style(img80, "width", "300px");
    			set_style(img80, "height", "320px");
    			add_location(img80, file$f, 518, 6, 30353);
    			attr_dev(p80, "id", "ped-name");
    			set_style(p80, "text-align", "center");
    			attr_dev(p80, "class", "svelte-1qp9z6g");
    			add_location(p80, file$f, 519, 6, 30521);
    			add_location(div100, file$f, 516, 4, 30287);
    			if (!src_url_equal(img81.src, img81_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133802021900787774/image.png")) attr_dev(img81, "src", img81_src_value);
    			set_style(img81, "border-radius", "10px");
    			set_style(img81, "width", "300px");
    			set_style(img81, "height", "320px");
    			add_location(img81, file$f, 523, 6, 30656);
    			attr_dev(p81, "id", "ped-name");
    			set_style(p81, "text-align", "center");
    			attr_dev(p81, "class", "svelte-1qp9z6g");
    			add_location(p81, file$f, 524, 6, 30824);
    			add_location(div101, file$f, 521, 4, 30590);
    			attr_dev(div102, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div102, file$f, 505, 2, 29574);
    			if (!src_url_equal(img82.src, img82_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133802098778181732/image.png")) attr_dev(img82, "src", img82_src_value);
    			set_style(img82, "border-radius", "10px");
    			set_style(img82, "width", "300px");
    			set_style(img82, "height", "320px");
    			add_location(img82, file$f, 531, 6, 31076);
    			attr_dev(p82, "id", "ped-name");
    			set_style(p82, "text-align", "center");
    			attr_dev(p82, "class", "svelte-1qp9z6g");
    			add_location(p82, file$f, 532, 6, 31244);
    			add_location(div103, file$f, 529, 4, 31008);
    			if (!src_url_equal(img83.src, img83_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133808290019680377/image.png?width=672&height=671")) attr_dev(img83, "src", img83_src_value);
    			set_style(img83, "border-radius", "10px");
    			set_style(img83, "width", "300px");
    			set_style(img83, "height", "320px");
    			add_location(img83, file$f, 536, 6, 31379);
    			attr_dev(p83, "id", "ped-name");
    			set_style(p83, "text-align", "center");
    			attr_dev(p83, "class", "svelte-1qp9z6g");
    			add_location(p83, file$f, 537, 6, 31568);
    			add_location(div104, file$f, 534, 4, 31313);
    			if (!src_url_equal(img84.src, img84_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133808700574945461/image.png?width=674&height=671")) attr_dev(img84, "src", img84_src_value);
    			set_style(img84, "border-radius", "10px");
    			set_style(img84, "width", "300px");
    			set_style(img84, "height", "320px");
    			add_location(img84, file$f, 541, 6, 31703);
    			attr_dev(p84, "id", "ped-name");
    			set_style(p84, "text-align", "center");
    			attr_dev(p84, "class", "svelte-1qp9z6g");
    			add_location(p84, file$f, 542, 6, 31892);
    			add_location(div105, file$f, 539, 4, 31637);
    			if (!src_url_equal(img85.src, img85_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133809964712992880/image.png?width=645&height=671")) attr_dev(img85, "src", img85_src_value);
    			set_style(img85, "border-radius", "10px");
    			set_style(img85, "width", "300px");
    			set_style(img85, "height", "320px");
    			add_location(img85, file$f, 546, 6, 32027);
    			attr_dev(p85, "id", "ped-name");
    			set_style(p85, "text-align", "center");
    			attr_dev(p85, "class", "svelte-1qp9z6g");
    			add_location(p85, file$f, 547, 6, 32216);
    			add_location(div106, file$f, 544, 4, 31961);
    			attr_dev(div107, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div107, file$f, 528, 2, 30903);
    			if (!src_url_equal(img86.src, img86_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133810858682757150/image.png")) attr_dev(img86, "src", img86_src_value);
    			set_style(img86, "border-radius", "10px");
    			set_style(img86, "width", "300px");
    			set_style(img86, "height", "320px");
    			add_location(img86, file$f, 554, 6, 32468);
    			attr_dev(p86, "id", "ped-name");
    			set_style(p86, "text-align", "center");
    			attr_dev(p86, "class", "svelte-1qp9z6g");
    			add_location(p86, file$f, 555, 6, 32636);
    			add_location(div108, file$f, 552, 4, 32400);
    			if (!src_url_equal(img87.src, img87_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133812205708644383/image.png?width=928&height=671")) attr_dev(img87, "src", img87_src_value);
    			set_style(img87, "border-radius", "10px");
    			set_style(img87, "width", "300px");
    			set_style(img87, "height", "320px");
    			add_location(img87, file$f, 559, 6, 32771);
    			attr_dev(p87, "id", "ped-name");
    			set_style(p87, "text-align", "center");
    			attr_dev(p87, "class", "svelte-1qp9z6g");
    			add_location(p87, file$f, 560, 6, 32960);
    			add_location(div109, file$f, 557, 4, 32705);
    			if (!src_url_equal(img88.src, img88_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134068802141835354/image.png?width=463&height=608")) attr_dev(img88, "src", img88_src_value);
    			set_style(img88, "border-radius", "10px");
    			set_style(img88, "width", "300px");
    			set_style(img88, "height", "320px");
    			add_location(img88, file$f, 564, 6, 33095);
    			attr_dev(p88, "id", "ped-name");
    			set_style(p88, "text-align", "center");
    			attr_dev(p88, "class", "svelte-1qp9z6g");
    			add_location(p88, file$f, 565, 6, 33284);
    			add_location(div110, file$f, 562, 4, 33029);
    			if (!src_url_equal(img89.src, img89_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133812643308785766/image.png")) attr_dev(img89, "src", img89_src_value);
    			set_style(img89, "border-radius", "10px");
    			set_style(img89, "width", "300px");
    			set_style(img89, "height", "320px");
    			add_location(img89, file$f, 569, 6, 33419);
    			attr_dev(p89, "id", "ped-name");
    			set_style(p89, "text-align", "center");
    			attr_dev(p89, "class", "svelte-1qp9z6g");
    			add_location(p89, file$f, 570, 6, 33587);
    			add_location(div111, file$f, 567, 4, 33353);
    			attr_dev(div112, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div112, file$f, 551, 2, 32295);
    			if (!src_url_equal(img90.src, img90_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133813809757298708/image.png?width=594&height=671")) attr_dev(img90, "src", img90_src_value);
    			set_style(img90, "border-radius", "10px");
    			set_style(img90, "width", "300px");
    			set_style(img90, "height", "320px");
    			add_location(img90, file$f, 577, 6, 33840);
    			attr_dev(p90, "id", "ped-name");
    			set_style(p90, "text-align", "center");
    			attr_dev(p90, "class", "svelte-1qp9z6g");
    			add_location(p90, file$f, 578, 6, 34029);
    			add_location(div113, file$f, 575, 4, 33772);
    			if (!src_url_equal(img91.src, img91_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133815240266625194/image.png?width=614&height=671")) attr_dev(img91, "src", img91_src_value);
    			set_style(img91, "border-radius", "10px");
    			set_style(img91, "width", "300px");
    			set_style(img91, "height", "320px");
    			add_location(img91, file$f, 582, 6, 34164);
    			attr_dev(p91, "id", "ped-name");
    			set_style(p91, "text-align", "center");
    			attr_dev(p91, "class", "svelte-1qp9z6g");
    			add_location(p91, file$f, 583, 6, 34353);
    			add_location(div114, file$f, 580, 4, 34098);
    			if (!src_url_equal(img92.src, img92_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133815470223536228/image.png")) attr_dev(img92, "src", img92_src_value);
    			set_style(img92, "border-radius", "10px");
    			set_style(img92, "width", "300px");
    			set_style(img92, "height", "320px");
    			add_location(img92, file$f, 587, 6, 34488);
    			attr_dev(p92, "id", "ped-name");
    			set_style(p92, "text-align", "center");
    			attr_dev(p92, "class", "svelte-1qp9z6g");
    			add_location(p92, file$f, 588, 6, 34656);
    			add_location(div115, file$f, 585, 4, 34422);
    			if (!src_url_equal(img93.src, img93_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133815649936871424/image.png")) attr_dev(img93, "src", img93_src_value);
    			set_style(img93, "border-radius", "10px");
    			set_style(img93, "width", "300px");
    			set_style(img93, "height", "320px");
    			add_location(img93, file$f, 592, 6, 34791);
    			attr_dev(p93, "id", "ped-name");
    			set_style(p93, "text-align", "center");
    			attr_dev(p93, "class", "svelte-1qp9z6g");
    			add_location(p93, file$f, 593, 6, 34959);
    			add_location(div116, file$f, 590, 4, 34725);
    			attr_dev(div117, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div117, file$f, 574, 2, 33667);
    			if (!src_url_equal(img94.src, img94_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133815907957887016/image.png")) attr_dev(img94, "src", img94_src_value);
    			set_style(img94, "border-radius", "10px");
    			set_style(img94, "width", "300px");
    			set_style(img94, "height", "320px");
    			add_location(img94, file$f, 600, 6, 35209);
    			attr_dev(p94, "id", "ped-name");
    			set_style(p94, "text-align", "center");
    			attr_dev(p94, "class", "svelte-1qp9z6g");
    			add_location(p94, file$f, 601, 6, 35377);
    			add_location(div118, file$f, 598, 4, 35143);
    			if (!src_url_equal(img95.src, img95_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133815984923357337/image.png")) attr_dev(img95, "src", img95_src_value);
    			set_style(img95, "border-radius", "10px");
    			set_style(img95, "width", "300px");
    			set_style(img95, "height", "320px");
    			add_location(img95, file$f, 605, 6, 35514);
    			attr_dev(p95, "id", "ped-name");
    			set_style(p95, "text-align", "center");
    			attr_dev(p95, "class", "svelte-1qp9z6g");
    			add_location(p95, file$f, 606, 6, 35682);
    			add_location(div119, file$f, 603, 4, 35448);
    			if (!src_url_equal(img96.src, img96_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133816244626272256/image.png")) attr_dev(img96, "src", img96_src_value);
    			set_style(img96, "border-radius", "10px");
    			set_style(img96, "width", "300px");
    			set_style(img96, "height", "320px");
    			add_location(img96, file$f, 610, 6, 35817);
    			attr_dev(p96, "id", "ped-name");
    			set_style(p96, "text-align", "center");
    			attr_dev(p96, "class", "svelte-1qp9z6g");
    			add_location(p96, file$f, 611, 6, 35985);
    			add_location(div120, file$f, 608, 4, 35751);
    			if (!src_url_equal(img97.src, img97_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133816584067088424/image.png")) attr_dev(img97, "src", img97_src_value);
    			set_style(img97, "border-radius", "10px");
    			set_style(img97, "width", "300px");
    			set_style(img97, "height", "320px");
    			add_location(img97, file$f, 615, 6, 36120);
    			attr_dev(p97, "id", "ped-name");
    			set_style(p97, "text-align", "center");
    			attr_dev(p97, "class", "svelte-1qp9z6g");
    			add_location(p97, file$f, 616, 6, 36288);
    			add_location(div121, file$f, 613, 4, 36054);
    			attr_dev(div122, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div122, file$f, 597, 2, 35038);
    			if (!src_url_equal(img98.src, img98_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133816923843477534/image.png")) attr_dev(img98, "src", img98_src_value);
    			set_style(img98, "border-radius", "10px");
    			set_style(img98, "width", "300px");
    			set_style(img98, "height", "320px");
    			add_location(img98, file$f, 623, 6, 36542);
    			attr_dev(p98, "id", "ped-name");
    			set_style(p98, "text-align", "center");
    			attr_dev(p98, "class", "svelte-1qp9z6g");
    			add_location(p98, file$f, 624, 6, 36710);
    			add_location(div123, file$f, 621, 4, 36474);
    			if (!src_url_equal(img99.src, img99_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133817124314423487/image.png")) attr_dev(img99, "src", img99_src_value);
    			set_style(img99, "border-radius", "10px");
    			set_style(img99, "width", "300px");
    			set_style(img99, "height", "320px");
    			add_location(img99, file$f, 628, 6, 36845);
    			attr_dev(p99, "id", "ped-name");
    			set_style(p99, "text-align", "center");
    			attr_dev(p99, "class", "svelte-1qp9z6g");
    			add_location(p99, file$f, 629, 6, 37013);
    			add_location(div124, file$f, 626, 4, 36779);
    			if (!src_url_equal(img100.src, img100_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133817269097603112/image.png")) attr_dev(img100, "src", img100_src_value);
    			set_style(img100, "border-radius", "10px");
    			set_style(img100, "width", "300px");
    			set_style(img100, "height", "320px");
    			add_location(img100, file$f, 633, 6, 37148);
    			attr_dev(p100, "id", "ped-name");
    			set_style(p100, "text-align", "center");
    			attr_dev(p100, "class", "svelte-1qp9z6g");
    			add_location(p100, file$f, 634, 6, 37316);
    			add_location(div125, file$f, 631, 4, 37082);
    			if (!src_url_equal(img101.src, img101_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133817497225809991/image.png")) attr_dev(img101, "src", img101_src_value);
    			set_style(img101, "border-radius", "10px");
    			set_style(img101, "width", "300px");
    			set_style(img101, "height", "320px");
    			add_location(img101, file$f, 638, 6, 37453);
    			attr_dev(p101, "id", "ped-name");
    			set_style(p101, "text-align", "center");
    			attr_dev(p101, "class", "svelte-1qp9z6g");
    			add_location(p101, file$f, 639, 6, 37621);
    			add_location(div126, file$f, 636, 4, 37387);
    			attr_dev(div127, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div127, file$f, 620, 2, 36369);
    			if (!src_url_equal(img102.src, img102_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133817653123895416/image.png")) attr_dev(img102, "src", img102_src_value);
    			set_style(img102, "border-radius", "10px");
    			set_style(img102, "width", "300px");
    			set_style(img102, "height", "320px");
    			add_location(img102, file$f, 646, 6, 37873);
    			attr_dev(p102, "id", "ped-name");
    			set_style(p102, "text-align", "center");
    			attr_dev(p102, "class", "svelte-1qp9z6g");
    			add_location(p102, file$f, 647, 6, 38041);
    			add_location(div128, file$f, 644, 4, 37805);
    			if (!src_url_equal(img103.src, img103_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133817874016915536/image.png")) attr_dev(img103, "src", img103_src_value);
    			set_style(img103, "border-radius", "10px");
    			set_style(img103, "width", "300px");
    			set_style(img103, "height", "320px");
    			add_location(img103, file$f, 651, 6, 38177);
    			attr_dev(p103, "id", "ped-name");
    			set_style(p103, "text-align", "center");
    			attr_dev(p103, "class", "svelte-1qp9z6g");
    			add_location(p103, file$f, 652, 6, 38345);
    			add_location(div129, file$f, 649, 4, 38111);
    			if (!src_url_equal(img104.src, img104_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133818811573870724/image.png")) attr_dev(img104, "src", img104_src_value);
    			set_style(img104, "border-radius", "10px");
    			set_style(img104, "width", "300px");
    			set_style(img104, "height", "320px");
    			add_location(img104, file$f, 656, 6, 38481);
    			attr_dev(p104, "id", "ped-name");
    			set_style(p104, "text-align", "center");
    			attr_dev(p104, "class", "svelte-1qp9z6g");
    			add_location(p104, file$f, 657, 6, 38649);
    			add_location(div130, file$f, 654, 4, 38415);
    			if (!src_url_equal(img105.src, img105_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133819007066189884/image.png")) attr_dev(img105, "src", img105_src_value);
    			set_style(img105, "border-radius", "10px");
    			set_style(img105, "width", "300px");
    			set_style(img105, "height", "320px");
    			add_location(img105, file$f, 661, 6, 38787);
    			attr_dev(p105, "id", "ped-name");
    			set_style(p105, "text-align", "center");
    			attr_dev(p105, "class", "svelte-1qp9z6g");
    			add_location(p105, file$f, 662, 6, 38955);
    			add_location(div131, file$f, 659, 4, 38721);
    			attr_dev(div132, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div132, file$f, 643, 2, 37700);
    			if (!src_url_equal(img106.src, img106_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1133845372805062747/image.png")) attr_dev(img106, "src", img106_src_value);
    			set_style(img106, "border-radius", "10px");
    			set_style(img106, "width", "300px");
    			set_style(img106, "height", "320px");
    			add_location(img106, file$f, 669, 6, 39208);
    			attr_dev(p106, "id", "ped-name");
    			set_style(p106, "text-align", "center");
    			attr_dev(p106, "class", "svelte-1qp9z6g");
    			add_location(p106, file$f, 670, 6, 39376);
    			add_location(div133, file$f, 667, 4, 39140);
    			if (!src_url_equal(img107.src, img107_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134058609039396914/image.png")) attr_dev(img107, "src", img107_src_value);
    			set_style(img107, "border-radius", "10px");
    			set_style(img107, "width", "300px");
    			set_style(img107, "height", "320px");
    			add_location(img107, file$f, 674, 6, 39512);
    			attr_dev(p107, "id", "ped-name");
    			set_style(p107, "text-align", "center");
    			attr_dev(p107, "class", "svelte-1qp9z6g");
    			add_location(p107, file$f, 675, 6, 39680);
    			add_location(div134, file$f, 672, 4, 39446);
    			if (!src_url_equal(img108.src, img108_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134059778860142622/image.png")) attr_dev(img108, "src", img108_src_value);
    			set_style(img108, "border-radius", "10px");
    			set_style(img108, "width", "300px");
    			set_style(img108, "height", "320px");
    			add_location(img108, file$f, 679, 6, 39816);
    			attr_dev(p108, "id", "ped-name");
    			set_style(p108, "text-align", "center");
    			attr_dev(p108, "class", "svelte-1qp9z6g");
    			add_location(p108, file$f, 680, 6, 39984);
    			add_location(div135, file$f, 677, 4, 39750);
    			if (!src_url_equal(img109.src, img109_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134060220046389258/image.png")) attr_dev(img109, "src", img109_src_value);
    			set_style(img109, "border-radius", "10px");
    			set_style(img109, "width", "300px");
    			set_style(img109, "height", "320px");
    			add_location(img109, file$f, 684, 6, 40120);
    			attr_dev(p109, "id", "ped-name");
    			set_style(p109, "text-align", "center");
    			attr_dev(p109, "class", "svelte-1qp9z6g");
    			add_location(p109, file$f, 685, 6, 40288);
    			add_location(div136, file$f, 682, 4, 40054);
    			attr_dev(div137, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div137, file$f, 666, 2, 39035);
    			if (!src_url_equal(img110.src, img110_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134062283325186058/image.png?width=433&height=608")) attr_dev(img110, "src", img110_src_value);
    			set_style(img110, "border-radius", "10px");
    			set_style(img110, "width", "300px");
    			set_style(img110, "height", "320px");
    			add_location(img110, file$f, 692, 2, 40535);
    			attr_dev(p110, "id", "ped-name");
    			set_style(p110, "text-align", "center");
    			attr_dev(p110, "class", "svelte-1qp9z6g");
    			add_location(p110, file$f, 693, 2, 40720);
    			add_location(div138, file$f, 690, 4, 40473);
    			if (!src_url_equal(img111.src, img111_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134062419216441424/image.png")) attr_dev(img111, "src", img111_src_value);
    			set_style(img111, "border-radius", "10px");
    			set_style(img111, "width", "300px");
    			set_style(img111, "height", "320px");
    			add_location(img111, file$f, 697, 2, 40851);
    			attr_dev(p111, "id", "ped-name");
    			set_style(p111, "text-align", "center");
    			attr_dev(p111, "class", "svelte-1qp9z6g");
    			add_location(p111, file$f, 698, 2, 41015);
    			add_location(div139, file$f, 695, 4, 40789);
    			if (!src_url_equal(img112.src, img112_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134062743608103033/image.png")) attr_dev(img112, "src", img112_src_value);
    			set_style(img112, "border-radius", "10px");
    			set_style(img112, "width", "300px");
    			set_style(img112, "height", "320px");
    			add_location(img112, file$f, 702, 2, 41143);
    			attr_dev(p112, "id", "ped-name");
    			set_style(p112, "text-align", "center");
    			attr_dev(p112, "class", "svelte-1qp9z6g");
    			add_location(p112, file$f, 703, 2, 41307);
    			add_location(div140, file$f, 700, 4, 41081);
    			if (!src_url_equal(img113.src, img113_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134063066812784650/image.png")) attr_dev(img113, "src", img113_src_value);
    			set_style(img113, "border-radius", "10px");
    			set_style(img113, "width", "300px");
    			set_style(img113, "height", "320px");
    			add_location(img113, file$f, 707, 2, 41435);
    			attr_dev(p113, "id", "ped-name");
    			set_style(p113, "text-align", "center");
    			attr_dev(p113, "class", "svelte-1qp9z6g");
    			add_location(p113, file$f, 708, 2, 41599);
    			add_location(div141, file$f, 705, 4, 41373);
    			attr_dev(div142, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div142, file$f, 689, 2, 40368);
    			if (!src_url_equal(img114.src, img114_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134063786249166960/image.png")) attr_dev(img114, "src", img114_src_value);
    			set_style(img114, "border-radius", "10px");
    			set_style(img114, "width", "300px");
    			set_style(img114, "height", "320px");
    			add_location(img114, file$f, 715, 2, 41844);
    			attr_dev(p114, "id", "ped-name");
    			set_style(p114, "text-align", "center");
    			attr_dev(p114, "class", "svelte-1qp9z6g");
    			add_location(p114, file$f, 716, 2, 42008);
    			add_location(div143, file$f, 713, 4, 41780);
    			if (!src_url_equal(img115.src, img115_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134064163199668277/image.png")) attr_dev(img115, "src", img115_src_value);
    			set_style(img115, "border-radius", "10px");
    			set_style(img115, "width", "300px");
    			set_style(img115, "height", "320px");
    			add_location(img115, file$f, 720, 2, 42138);
    			attr_dev(p115, "id", "ped-name");
    			set_style(p115, "text-align", "center");
    			attr_dev(p115, "class", "svelte-1qp9z6g");
    			add_location(p115, file$f, 721, 2, 42302);
    			add_location(div144, file$f, 718, 4, 42076);
    			if (!src_url_equal(img116.src, img116_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134064465571217519/image.png")) attr_dev(img116, "src", img116_src_value);
    			set_style(img116, "border-radius", "10px");
    			set_style(img116, "width", "300px");
    			set_style(img116, "height", "320px");
    			add_location(img116, file$f, 725, 2, 42430);
    			attr_dev(p116, "id", "ped-name");
    			set_style(p116, "text-align", "center");
    			attr_dev(p116, "class", "svelte-1qp9z6g");
    			add_location(p116, file$f, 726, 2, 42594);
    			add_location(div145, file$f, 723, 4, 42368);
    			if (!src_url_equal(img117.src, img117_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134064865955291177/image.png?width=481&height=608")) attr_dev(img117, "src", img117_src_value);
    			set_style(img117, "border-radius", "10px");
    			set_style(img117, "width", "300px");
    			set_style(img117, "height", "320px");
    			add_location(img117, file$f, 730, 2, 42726);
    			attr_dev(p117, "id", "ped-name");
    			set_style(p117, "text-align", "center");
    			attr_dev(p117, "class", "svelte-1qp9z6g");
    			add_location(p117, file$f, 731, 2, 42911);
    			add_location(div146, file$f, 728, 4, 42664);
    			attr_dev(div147, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div147, file$f, 712, 2, 41675);
    			if (!src_url_equal(img118.src, img118_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134065111666008165/image.png")) attr_dev(img118, "src", img118_src_value);
    			set_style(img118, "border-radius", "10px");
    			set_style(img118, "width", "300px");
    			set_style(img118, "height", "320px");
    			add_location(img118, file$f, 738, 2, 43155);
    			attr_dev(p118, "id", "ped-name");
    			set_style(p118, "text-align", "center");
    			attr_dev(p118, "class", "svelte-1qp9z6g");
    			add_location(p118, file$f, 739, 2, 43319);
    			add_location(div148, file$f, 736, 4, 43091);
    			if (!src_url_equal(img119.src, img119_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134065512222048346/image.png")) attr_dev(img119, "src", img119_src_value);
    			set_style(img119, "border-radius", "10px");
    			set_style(img119, "width", "300px");
    			set_style(img119, "height", "320px");
    			add_location(img119, file$f, 743, 2, 43447);
    			attr_dev(p119, "id", "ped-name");
    			set_style(p119, "text-align", "center");
    			attr_dev(p119, "class", "svelte-1qp9z6g");
    			add_location(p119, file$f, 744, 2, 43611);
    			add_location(div149, file$f, 741, 4, 43385);
    			if (!src_url_equal(img120.src, img120_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134066412776865893/image.png?width=478&height=607")) attr_dev(img120, "src", img120_src_value);
    			set_style(img120, "border-radius", "10px");
    			set_style(img120, "width", "300px");
    			set_style(img120, "height", "320px");
    			add_location(img120, file$f, 748, 2, 43739);
    			attr_dev(p120, "id", "ped-name");
    			set_style(p120, "text-align", "center");
    			attr_dev(p120, "class", "svelte-1qp9z6g");
    			add_location(p120, file$f, 749, 2, 43924);
    			add_location(div150, file$f, 746, 4, 43677);
    			if (!src_url_equal(img121.src, img121_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134142111713861703/image.png")) attr_dev(img121, "src", img121_src_value);
    			attr_dev(img121, "alt", "");
    			set_style(img121, "border-radius", "10px");
    			set_style(img121, "width", "300px");
    			set_style(img121, "height", "320px");
    			add_location(img121, file$f, 753, 4, 44050);
    			attr_dev(p121, "id", "ped-name");
    			set_style(p121, "text-align", "center");
    			attr_dev(p121, "class", "svelte-1qp9z6g");
    			add_location(p121, file$f, 754, 4, 44223);
    			add_location(div151, file$f, 751, 2, 43988);
    			attr_dev(div152, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div152, file$f, 735, 1, 42986);
    			if (!src_url_equal(img122.src, img122_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134450341627306134/u_m_y_ushi-removebg-preview.png")) attr_dev(img122, "src", img122_src_value);
    			set_style(img122, "border-radius", "10px");
    			set_style(img122, "width", "300px");
    			set_style(img122, "height", "320px");
    			add_location(img122, file$f, 761, 2, 44473);
    			attr_dev(p122, "id", "ped-name");
    			set_style(p122, "text-align", "center");
    			attr_dev(p122, "class", "svelte-1qp9z6g");
    			add_location(p122, file$f, 762, 2, 44659);
    			add_location(div153, file$f, 759, 4, 44409);
    			if (!src_url_equal(img123.src, img123_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134506712162910279/image.png")) attr_dev(img123, "src", img123_src_value);
    			attr_dev(img123, "style", "border-radius: 10px; width: 300px; height: 320px; background-color : white");
    			add_location(img123, file$f, 766, 2, 44787);
    			attr_dev(p123, "id", "ped-name");
    			set_style(p123, "text-align", "center");
    			attr_dev(p123, "class", "svelte-1qp9z6g");
    			add_location(p123, file$f, 767, 2, 44978);
    			add_location(div154, file$f, 764, 4, 44725);
    			if (!src_url_equal(img124.src, img124_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134506738184368289/image.png")) attr_dev(img124, "src", img124_src_value);
    			set_style(img124, "border-radius", "10px");
    			set_style(img124, "width", "300px");
    			set_style(img124, "height", "320px");
    			add_location(img124, file$f, 771, 2, 45106);
    			attr_dev(p124, "id", "ped-name");
    			set_style(p124, "text-align", "center");
    			attr_dev(p124, "class", "svelte-1qp9z6g");
    			add_location(p124, file$f, 772, 2, 45270);
    			add_location(div155, file$f, 769, 4, 45044);
    			if (!src_url_equal(img125.src, img125_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134506795931545610/image.png?width=378&height=558")) attr_dev(img125, "src", img125_src_value);
    			attr_dev(img125, "alt", "");
    			set_style(img125, "border-radius", "10px");
    			set_style(img125, "width", "300px");
    			set_style(img125, "height", "320px");
    			add_location(img125, file$f, 776, 4, 45396);
    			attr_dev(p125, "id", "ped-name");
    			set_style(p125, "text-align", "center");
    			attr_dev(p125, "class", "svelte-1qp9z6g");
    			add_location(p125, file$f, 777, 4, 45590);
    			add_location(div156, file$f, 774, 2, 45334);
    			attr_dev(div157, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div157, file$f, 758, 2, 44304);
    			if (!src_url_equal(img126.src, img126_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134506866521682052/image.png")) attr_dev(img126, "src", img126_src_value);
    			set_style(img126, "border-radius", "10px");
    			set_style(img126, "width", "300px");
    			set_style(img126, "height", "320px");
    			add_location(img126, file$f, 784, 2, 45840);
    			attr_dev(p126, "id", "ped-name");
    			set_style(p126, "text-align", "center");
    			attr_dev(p126, "class", "svelte-1qp9z6g");
    			add_location(p126, file$f, 785, 2, 46004);
    			add_location(div158, file$f, 782, 4, 45776);
    			if (!src_url_equal(img127.src, img127_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134506892186632362/image.png")) attr_dev(img127, "src", img127_src_value);
    			attr_dev(img127, "style", "border-radius: 10px; width: 300px; height: 320px; background-color : white");
    			add_location(img127, file$f, 789, 2, 46132);
    			attr_dev(p127, "id", "ped-name");
    			set_style(p127, "text-align", "center");
    			attr_dev(p127, "class", "svelte-1qp9z6g");
    			add_location(p127, file$f, 790, 2, 46323);
    			add_location(div159, file$f, 787, 4, 46070);
    			if (!src_url_equal(img128.src, img128_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134506919718027284/image.png")) attr_dev(img128, "src", img128_src_value);
    			set_style(img128, "border-radius", "10px");
    			set_style(img128, "width", "300px");
    			set_style(img128, "height", "320px");
    			add_location(img128, file$f, 794, 2, 46451);
    			attr_dev(p128, "id", "ped-name");
    			set_style(p128, "text-align", "center");
    			attr_dev(p128, "class", "svelte-1qp9z6g");
    			add_location(p128, file$f, 795, 2, 46615);
    			add_location(div160, file$f, 792, 4, 46389);
    			if (!src_url_equal(img129.src, img129_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134506942270820462/image.png")) attr_dev(img129, "src", img129_src_value);
    			attr_dev(img129, "alt", "");
    			set_style(img129, "border-radius", "10px");
    			set_style(img129, "width", "300px");
    			set_style(img129, "height", "320px");
    			add_location(img129, file$f, 799, 4, 46741);
    			attr_dev(p129, "id", "ped-name");
    			set_style(p129, "text-align", "center");
    			attr_dev(p129, "class", "svelte-1qp9z6g");
    			add_location(p129, file$f, 800, 4, 46914);
    			add_location(div161, file$f, 797, 2, 46679);
    			attr_dev(div162, "style", "display: flex; justify-content : space-around ; margin-top : 15px ; flex-wrap: wrap ;");
    			add_location(div162, file$f, 781, 2, 45671);
    			set_style(section1, "margin-top", "10px");
    			add_location(section1, file$f, 64, 0, 4034);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$f, 812, 280, 47750);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$f, 812, 331, 47801);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$f, 812, 16, 47486);
    			add_location(button2, file$f, 811, 12, 47435);
    			attr_dev(p130, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p130, file$f, 814, 12, 47963);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$f, 815, 12, 48046);
    			attr_dev(p131, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p131, file$f, 816, 12, 48169);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$f, 817, 12, 48235);
    			attr_dev(div163, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div163, file$f, 810, 8, 47352);
    			attr_dev(section2, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section2, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section2, "z-index", "1000");
    			set_style(section2, "backdrop-filter", "blur(10px)");
    			set_style(section2, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section2, "display", "none");
    			attr_dev(section2, "id", "connect-overlay");
    			add_location(section2, file$f, 809, 4, 47109);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img0);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span0);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, section0, anchor);
    			append_dev(section0, img1);
    			append_dev(section0, t14);
    			append_dev(section0, p0);
    			append_dev(p0, span1);
    			append_dev(p0, t16);
    			append_dev(section0, t17);
    			append_dev(section0, p1);
    			insert_dev(target, t19, anchor);
    			insert_dev(target, section1, anchor);
    			append_dev(section1, div7);
    			append_dev(div7, div3);
    			append_dev(div3, img2);
    			append_dev(div3, t20);
    			append_dev(div3, p2);
    			append_dev(div7, t22);
    			append_dev(div7, div4);
    			append_dev(div4, img3);
    			append_dev(div4, t23);
    			append_dev(div4, p3);
    			append_dev(div7, t25);
    			append_dev(div7, div5);
    			append_dev(div5, img4);
    			append_dev(div5, t26);
    			append_dev(div5, p4);
    			append_dev(div7, t28);
    			append_dev(div7, div6);
    			append_dev(div6, img5);
    			append_dev(div6, t29);
    			append_dev(div6, p5);
    			append_dev(section1, t31);
    			append_dev(section1, div12);
    			append_dev(div12, div8);
    			append_dev(div8, img6);
    			append_dev(div8, t32);
    			append_dev(div8, p6);
    			append_dev(div12, t34);
    			append_dev(div12, div9);
    			append_dev(div9, img7);
    			append_dev(div9, t35);
    			append_dev(div9, p7);
    			append_dev(div12, t37);
    			append_dev(div12, div10);
    			append_dev(div10, img8);
    			append_dev(div10, t38);
    			append_dev(div10, p8);
    			append_dev(div12, t40);
    			append_dev(div12, div11);
    			append_dev(div11, img9);
    			append_dev(div11, t41);
    			append_dev(div11, p9);
    			append_dev(section1, t43);
    			append_dev(section1, div17);
    			append_dev(div17, div13);
    			append_dev(div13, img10);
    			append_dev(div13, t44);
    			append_dev(div13, p10);
    			append_dev(div17, t46);
    			append_dev(div17, div14);
    			append_dev(div14, img11);
    			append_dev(div14, t47);
    			append_dev(div14, p11);
    			append_dev(div17, t49);
    			append_dev(div17, div15);
    			append_dev(div15, img12);
    			append_dev(div15, t50);
    			append_dev(div15, p12);
    			append_dev(div17, t52);
    			append_dev(div17, div16);
    			append_dev(div16, img13);
    			append_dev(div16, t53);
    			append_dev(div16, p13);
    			append_dev(section1, t55);
    			append_dev(section1, div22);
    			append_dev(div22, div18);
    			append_dev(div18, img14);
    			append_dev(div18, t56);
    			append_dev(div18, p14);
    			append_dev(div22, t58);
    			append_dev(div22, div19);
    			append_dev(div19, img15);
    			append_dev(div19, t59);
    			append_dev(div19, p15);
    			append_dev(div22, t61);
    			append_dev(div22, div20);
    			append_dev(div20, img16);
    			append_dev(div20, t62);
    			append_dev(div20, p16);
    			append_dev(div22, t64);
    			append_dev(div22, div21);
    			append_dev(div21, img17);
    			append_dev(div21, t65);
    			append_dev(div21, p17);
    			append_dev(section1, t67);
    			append_dev(section1, div27);
    			append_dev(div27, div23);
    			append_dev(div23, img18);
    			append_dev(div23, t68);
    			append_dev(div23, p18);
    			append_dev(div27, t70);
    			append_dev(div27, div24);
    			append_dev(div24, img19);
    			append_dev(div24, t71);
    			append_dev(div24, p19);
    			append_dev(div27, t73);
    			append_dev(div27, div25);
    			append_dev(div25, img20);
    			append_dev(div25, t74);
    			append_dev(div25, p20);
    			append_dev(div27, t76);
    			append_dev(div27, div26);
    			append_dev(div26, img21);
    			append_dev(div26, t77);
    			append_dev(div26, p21);
    			append_dev(section1, t79);
    			append_dev(section1, div32);
    			append_dev(div32, div28);
    			append_dev(div28, img22);
    			append_dev(div28, t80);
    			append_dev(div28, p22);
    			append_dev(div32, t82);
    			append_dev(div32, div29);
    			append_dev(div29, img23);
    			append_dev(div29, t83);
    			append_dev(div29, p23);
    			append_dev(div32, t85);
    			append_dev(div32, div30);
    			append_dev(div30, img24);
    			append_dev(div30, t86);
    			append_dev(div30, p24);
    			append_dev(div32, t88);
    			append_dev(div32, div31);
    			append_dev(div31, img25);
    			append_dev(div31, t89);
    			append_dev(div31, p25);
    			append_dev(section1, t91);
    			append_dev(section1, div37);
    			append_dev(div37, div33);
    			append_dev(div33, img26);
    			append_dev(div33, t92);
    			append_dev(div33, p26);
    			append_dev(div37, t94);
    			append_dev(div37, div34);
    			append_dev(div34, img27);
    			append_dev(div34, t95);
    			append_dev(div34, p27);
    			append_dev(div37, t97);
    			append_dev(div37, div35);
    			append_dev(div35, img28);
    			append_dev(div35, t98);
    			append_dev(div35, p28);
    			append_dev(div37, t100);
    			append_dev(div37, div36);
    			append_dev(div36, img29);
    			append_dev(div36, t101);
    			append_dev(div36, p29);
    			append_dev(section1, t103);
    			append_dev(section1, div42);
    			append_dev(div42, div38);
    			append_dev(div38, img30);
    			append_dev(div38, t104);
    			append_dev(div38, p30);
    			append_dev(div42, t106);
    			append_dev(div42, div39);
    			append_dev(div39, img31);
    			append_dev(div39, t107);
    			append_dev(div39, p31);
    			append_dev(div42, t109);
    			append_dev(div42, div40);
    			append_dev(div40, img32);
    			append_dev(div40, t110);
    			append_dev(div40, p32);
    			append_dev(div42, t112);
    			append_dev(div42, div41);
    			append_dev(div41, img33);
    			append_dev(div41, t113);
    			append_dev(div41, p33);
    			append_dev(section1, t115);
    			append_dev(section1, div47);
    			append_dev(div47, div43);
    			append_dev(div43, img34);
    			append_dev(div43, t116);
    			append_dev(div43, p34);
    			append_dev(div47, t118);
    			append_dev(div47, div44);
    			append_dev(div44, img35);
    			append_dev(div44, t119);
    			append_dev(div44, p35);
    			append_dev(div47, t121);
    			append_dev(div47, div45);
    			append_dev(div45, img36);
    			append_dev(div45, t122);
    			append_dev(div45, p36);
    			append_dev(div47, t124);
    			append_dev(div47, div46);
    			append_dev(div46, img37);
    			append_dev(div46, t125);
    			append_dev(div46, p37);
    			append_dev(section1, t127);
    			append_dev(section1, div52);
    			append_dev(div52, div48);
    			append_dev(div48, img38);
    			append_dev(div48, t128);
    			append_dev(div48, p38);
    			append_dev(div52, t130);
    			append_dev(div52, div49);
    			append_dev(div49, img39);
    			append_dev(div49, t131);
    			append_dev(div49, p39);
    			append_dev(div52, t133);
    			append_dev(div52, div50);
    			append_dev(div50, img40);
    			append_dev(div50, t134);
    			append_dev(div50, p40);
    			append_dev(div52, t136);
    			append_dev(div52, div51);
    			append_dev(div51, img41);
    			append_dev(div51, t137);
    			append_dev(div51, p41);
    			append_dev(section1, t139);
    			append_dev(section1, div57);
    			append_dev(div57, div53);
    			append_dev(div53, img42);
    			append_dev(div53, t140);
    			append_dev(div53, p42);
    			append_dev(div57, t142);
    			append_dev(div57, div54);
    			append_dev(div54, img43);
    			append_dev(div54, t143);
    			append_dev(div54, p43);
    			append_dev(div57, t145);
    			append_dev(div57, div55);
    			append_dev(div55, img44);
    			append_dev(div55, t146);
    			append_dev(div55, p44);
    			append_dev(div57, t148);
    			append_dev(div57, div56);
    			append_dev(div56, img45);
    			append_dev(div56, t149);
    			append_dev(div56, p45);
    			append_dev(section1, t151);
    			append_dev(section1, div62);
    			append_dev(div62, div58);
    			append_dev(div58, img46);
    			append_dev(div58, t152);
    			append_dev(div58, p46);
    			append_dev(div62, t154);
    			append_dev(div62, div59);
    			append_dev(div59, img47);
    			append_dev(div59, t155);
    			append_dev(div59, p47);
    			append_dev(div62, t157);
    			append_dev(div62, div60);
    			append_dev(div60, img48);
    			append_dev(div60, t158);
    			append_dev(div60, p48);
    			append_dev(div62, t160);
    			append_dev(div62, div61);
    			append_dev(div61, img49);
    			append_dev(div61, t161);
    			append_dev(div61, p49);
    			append_dev(section1, t163);
    			append_dev(section1, div67);
    			append_dev(div67, div63);
    			append_dev(div63, img50);
    			append_dev(div63, t164);
    			append_dev(div63, p50);
    			append_dev(div67, t166);
    			append_dev(div67, div64);
    			append_dev(div64, img51);
    			append_dev(div64, t167);
    			append_dev(div64, p51);
    			append_dev(div67, t169);
    			append_dev(div67, div65);
    			append_dev(div65, img52);
    			append_dev(div65, t170);
    			append_dev(div65, p52);
    			append_dev(div67, t172);
    			append_dev(div67, div66);
    			append_dev(div66, img53);
    			append_dev(div66, t173);
    			append_dev(div66, p53);
    			append_dev(section1, t175);
    			append_dev(section1, div72);
    			append_dev(div72, div68);
    			append_dev(div68, img54);
    			append_dev(div68, t176);
    			append_dev(div68, p54);
    			append_dev(div72, t178);
    			append_dev(div72, div69);
    			append_dev(div69, img55);
    			append_dev(div69, t179);
    			append_dev(div69, p55);
    			append_dev(div72, t181);
    			append_dev(div72, div70);
    			append_dev(div70, img56);
    			append_dev(div70, t182);
    			append_dev(div70, p56);
    			append_dev(div72, t184);
    			append_dev(div72, div71);
    			append_dev(div71, img57);
    			append_dev(div71, t185);
    			append_dev(div71, p57);
    			append_dev(section1, t187);
    			append_dev(section1, div77);
    			append_dev(div77, div73);
    			append_dev(div73, img58);
    			append_dev(div73, t188);
    			append_dev(div73, p58);
    			append_dev(div77, t190);
    			append_dev(div77, div74);
    			append_dev(div74, img59);
    			append_dev(div74, t191);
    			append_dev(div74, p59);
    			append_dev(div77, t193);
    			append_dev(div77, div75);
    			append_dev(div75, img60);
    			append_dev(div75, t194);
    			append_dev(div75, p60);
    			append_dev(div77, t196);
    			append_dev(div77, div76);
    			append_dev(div76, img61);
    			append_dev(div76, t197);
    			append_dev(div76, p61);
    			append_dev(section1, t199);
    			append_dev(section1, div82);
    			append_dev(div82, div78);
    			append_dev(div78, img62);
    			append_dev(div78, t200);
    			append_dev(div78, p62);
    			append_dev(div82, t202);
    			append_dev(div82, div79);
    			append_dev(div79, img63);
    			append_dev(div79, t203);
    			append_dev(div79, p63);
    			append_dev(div82, t205);
    			append_dev(div82, div80);
    			append_dev(div80, img64);
    			append_dev(div80, t206);
    			append_dev(div80, p64);
    			append_dev(div82, t208);
    			append_dev(div82, div81);
    			append_dev(div81, img65);
    			append_dev(div81, t209);
    			append_dev(div81, p65);
    			append_dev(section1, t211);
    			append_dev(section1, div87);
    			append_dev(div87, div83);
    			append_dev(div83, img66);
    			append_dev(div83, t212);
    			append_dev(div83, p66);
    			append_dev(div87, t214);
    			append_dev(div87, div84);
    			append_dev(div84, img67);
    			append_dev(div84, t215);
    			append_dev(div84, p67);
    			append_dev(div87, t217);
    			append_dev(div87, div85);
    			append_dev(div85, img68);
    			append_dev(div85, t218);
    			append_dev(div85, p68);
    			append_dev(div87, t220);
    			append_dev(div87, div86);
    			append_dev(div86, img69);
    			append_dev(div86, t221);
    			append_dev(div86, p69);
    			append_dev(section1, t223);
    			append_dev(section1, div92);
    			append_dev(div92, div88);
    			append_dev(div88, img70);
    			append_dev(div88, t224);
    			append_dev(div88, p70);
    			append_dev(div92, t226);
    			append_dev(div92, div89);
    			append_dev(div89, img71);
    			append_dev(div89, t227);
    			append_dev(div89, p71);
    			append_dev(div92, t229);
    			append_dev(div92, div90);
    			append_dev(div90, img72);
    			append_dev(div90, t230);
    			append_dev(div90, p72);
    			append_dev(div92, t232);
    			append_dev(div92, div91);
    			append_dev(div91, img73);
    			append_dev(div91, t233);
    			append_dev(div91, p73);
    			append_dev(section1, t235);
    			append_dev(section1, div97);
    			append_dev(div97, div93);
    			append_dev(div93, img74);
    			append_dev(div93, t236);
    			append_dev(div93, p74);
    			append_dev(div97, t238);
    			append_dev(div97, div94);
    			append_dev(div94, img75);
    			append_dev(div94, t239);
    			append_dev(div94, p75);
    			append_dev(div97, t241);
    			append_dev(div97, div95);
    			append_dev(div95, img76);
    			append_dev(div95, t242);
    			append_dev(div95, p76);
    			append_dev(div97, t244);
    			append_dev(div97, div96);
    			append_dev(div96, img77);
    			append_dev(div96, t245);
    			append_dev(div96, p77);
    			append_dev(section1, t247);
    			append_dev(section1, div102);
    			append_dev(div102, div98);
    			append_dev(div98, img78);
    			append_dev(div98, t248);
    			append_dev(div98, p78);
    			append_dev(div102, t250);
    			append_dev(div102, div99);
    			append_dev(div99, img79);
    			append_dev(div99, t251);
    			append_dev(div99, p79);
    			append_dev(div102, t253);
    			append_dev(div102, div100);
    			append_dev(div100, img80);
    			append_dev(div100, t254);
    			append_dev(div100, p80);
    			append_dev(div102, t256);
    			append_dev(div102, div101);
    			append_dev(div101, img81);
    			append_dev(div101, t257);
    			append_dev(div101, p81);
    			append_dev(section1, t259);
    			append_dev(section1, div107);
    			append_dev(div107, div103);
    			append_dev(div103, img82);
    			append_dev(div103, t260);
    			append_dev(div103, p82);
    			append_dev(div107, t262);
    			append_dev(div107, div104);
    			append_dev(div104, img83);
    			append_dev(div104, t263);
    			append_dev(div104, p83);
    			append_dev(div107, t265);
    			append_dev(div107, div105);
    			append_dev(div105, img84);
    			append_dev(div105, t266);
    			append_dev(div105, p84);
    			append_dev(div107, t268);
    			append_dev(div107, div106);
    			append_dev(div106, img85);
    			append_dev(div106, t269);
    			append_dev(div106, p85);
    			append_dev(section1, t271);
    			append_dev(section1, div112);
    			append_dev(div112, div108);
    			append_dev(div108, img86);
    			append_dev(div108, t272);
    			append_dev(div108, p86);
    			append_dev(div112, t274);
    			append_dev(div112, div109);
    			append_dev(div109, img87);
    			append_dev(div109, t275);
    			append_dev(div109, p87);
    			append_dev(div112, t277);
    			append_dev(div112, div110);
    			append_dev(div110, img88);
    			append_dev(div110, t278);
    			append_dev(div110, p88);
    			append_dev(div112, t280);
    			append_dev(div112, div111);
    			append_dev(div111, img89);
    			append_dev(div111, t281);
    			append_dev(div111, p89);
    			append_dev(section1, t283);
    			append_dev(section1, div117);
    			append_dev(div117, div113);
    			append_dev(div113, img90);
    			append_dev(div113, t284);
    			append_dev(div113, p90);
    			append_dev(div117, t286);
    			append_dev(div117, div114);
    			append_dev(div114, img91);
    			append_dev(div114, t287);
    			append_dev(div114, p91);
    			append_dev(div117, t289);
    			append_dev(div117, div115);
    			append_dev(div115, img92);
    			append_dev(div115, t290);
    			append_dev(div115, p92);
    			append_dev(div117, t292);
    			append_dev(div117, div116);
    			append_dev(div116, img93);
    			append_dev(div116, t293);
    			append_dev(div116, p93);
    			append_dev(section1, t295);
    			append_dev(section1, div122);
    			append_dev(div122, div118);
    			append_dev(div118, img94);
    			append_dev(div118, t296);
    			append_dev(div118, p94);
    			append_dev(div122, t298);
    			append_dev(div122, div119);
    			append_dev(div119, img95);
    			append_dev(div119, t299);
    			append_dev(div119, p95);
    			append_dev(div122, t301);
    			append_dev(div122, div120);
    			append_dev(div120, img96);
    			append_dev(div120, t302);
    			append_dev(div120, p96);
    			append_dev(div122, t304);
    			append_dev(div122, div121);
    			append_dev(div121, img97);
    			append_dev(div121, t305);
    			append_dev(div121, p97);
    			append_dev(section1, t307);
    			append_dev(section1, div127);
    			append_dev(div127, div123);
    			append_dev(div123, img98);
    			append_dev(div123, t308);
    			append_dev(div123, p98);
    			append_dev(div127, t310);
    			append_dev(div127, div124);
    			append_dev(div124, img99);
    			append_dev(div124, t311);
    			append_dev(div124, p99);
    			append_dev(div127, t313);
    			append_dev(div127, div125);
    			append_dev(div125, img100);
    			append_dev(div125, t314);
    			append_dev(div125, p100);
    			append_dev(div127, t316);
    			append_dev(div127, div126);
    			append_dev(div126, img101);
    			append_dev(div126, t317);
    			append_dev(div126, p101);
    			append_dev(section1, t319);
    			append_dev(section1, div132);
    			append_dev(div132, div128);
    			append_dev(div128, img102);
    			append_dev(div128, t320);
    			append_dev(div128, p102);
    			append_dev(div132, t322);
    			append_dev(div132, div129);
    			append_dev(div129, img103);
    			append_dev(div129, t323);
    			append_dev(div129, p103);
    			append_dev(div132, t325);
    			append_dev(div132, div130);
    			append_dev(div130, img104);
    			append_dev(div130, t326);
    			append_dev(div130, p104);
    			append_dev(div132, t328);
    			append_dev(div132, div131);
    			append_dev(div131, img105);
    			append_dev(div131, t329);
    			append_dev(div131, p105);
    			append_dev(section1, t331);
    			append_dev(section1, div137);
    			append_dev(div137, div133);
    			append_dev(div133, img106);
    			append_dev(div133, t332);
    			append_dev(div133, p106);
    			append_dev(div137, t334);
    			append_dev(div137, div134);
    			append_dev(div134, img107);
    			append_dev(div134, t335);
    			append_dev(div134, p107);
    			append_dev(div137, t337);
    			append_dev(div137, div135);
    			append_dev(div135, img108);
    			append_dev(div135, t338);
    			append_dev(div135, p108);
    			append_dev(div137, t340);
    			append_dev(div137, div136);
    			append_dev(div136, img109);
    			append_dev(div136, t341);
    			append_dev(div136, p109);
    			append_dev(section1, t343);
    			append_dev(section1, div142);
    			append_dev(div142, div138);
    			append_dev(div138, img110);
    			append_dev(div138, t344);
    			append_dev(div138, p110);
    			append_dev(div142, t346);
    			append_dev(div142, div139);
    			append_dev(div139, img111);
    			append_dev(div139, t347);
    			append_dev(div139, p111);
    			append_dev(div142, t349);
    			append_dev(div142, div140);
    			append_dev(div140, img112);
    			append_dev(div140, t350);
    			append_dev(div140, p112);
    			append_dev(div142, t352);
    			append_dev(div142, div141);
    			append_dev(div141, img113);
    			append_dev(div141, t353);
    			append_dev(div141, p113);
    			append_dev(section1, t355);
    			append_dev(section1, div147);
    			append_dev(div147, div143);
    			append_dev(div143, img114);
    			append_dev(div143, t356);
    			append_dev(div143, p114);
    			append_dev(div147, t358);
    			append_dev(div147, div144);
    			append_dev(div144, img115);
    			append_dev(div144, t359);
    			append_dev(div144, p115);
    			append_dev(div147, t361);
    			append_dev(div147, div145);
    			append_dev(div145, img116);
    			append_dev(div145, t362);
    			append_dev(div145, p116);
    			append_dev(div147, t364);
    			append_dev(div147, div146);
    			append_dev(div146, img117);
    			append_dev(div146, t365);
    			append_dev(div146, p117);
    			append_dev(section1, t367);
    			append_dev(section1, div152);
    			append_dev(div152, div148);
    			append_dev(div148, img118);
    			append_dev(div148, t368);
    			append_dev(div148, p118);
    			append_dev(div152, t370);
    			append_dev(div152, div149);
    			append_dev(div149, img119);
    			append_dev(div149, t371);
    			append_dev(div149, p119);
    			append_dev(div152, t373);
    			append_dev(div152, div150);
    			append_dev(div150, img120);
    			append_dev(div150, t374);
    			append_dev(div150, p120);
    			append_dev(div152, t376);
    			append_dev(div152, div151);
    			append_dev(div151, img121);
    			append_dev(div151, t377);
    			append_dev(div151, p121);
    			append_dev(section1, t379);
    			append_dev(section1, div157);
    			append_dev(div157, div153);
    			append_dev(div153, img122);
    			append_dev(div153, t380);
    			append_dev(div153, p122);
    			append_dev(div157, t382);
    			append_dev(div157, div154);
    			append_dev(div154, img123);
    			append_dev(div154, t383);
    			append_dev(div154, p123);
    			append_dev(div157, t385);
    			append_dev(div157, div155);
    			append_dev(div155, img124);
    			append_dev(div155, t386);
    			append_dev(div155, p124);
    			append_dev(div157, t388);
    			append_dev(div157, div156);
    			append_dev(div156, img125);
    			append_dev(div156, t389);
    			append_dev(div156, p125);
    			append_dev(section1, t391);
    			append_dev(section1, div162);
    			append_dev(div162, div158);
    			append_dev(div158, img126);
    			append_dev(div158, t392);
    			append_dev(div158, p126);
    			append_dev(div162, t394);
    			append_dev(div162, div159);
    			append_dev(div159, img127);
    			append_dev(div159, t395);
    			append_dev(div159, p127);
    			append_dev(div162, t397);
    			append_dev(div162, div160);
    			append_dev(div160, img128);
    			append_dev(div160, t398);
    			append_dev(div160, p128);
    			append_dev(div162, t400);
    			append_dev(div162, div161);
    			append_dev(div161, img129);
    			append_dev(div161, t401);
    			append_dev(div161, p129);
    			insert_dev(target, t403, anchor);
    			insert_dev(target, section2, anchor);
    			append_dev(section2, div163);
    			append_dev(div163, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div163, t404);
    			append_dev(div163, p130);
    			append_dev(div163, t406);
    			append_dev(div163, input);
    			append_dev(div163, t407);
    			append_dev(div163, p131);
    			append_dev(div163, t409);
    			append_dev(div163, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$d, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$d, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(section0);
    			if (detaching) detach_dev(t19);
    			if (detaching) detach_dev(section1);
    			if (detaching) detach_dev(t403);
    			if (detaching) detach_dev(section2);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$g.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$d() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$d() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$g($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Peds', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Peds> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$d, close_overlay: close_overlay$d });
    	return [];
    }

    class Peds extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$g, create_fragment$g, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Peds",
    			options,
    			id: create_fragment$g.name
    		});
    	}
    }

    /* src\routes\Vehicles.svelte generated by Svelte v3.59.2 */

    const file$g = "src\\routes\\Vehicles.svelte";

    function create_fragment$h(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img0;
    	let img0_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span0;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let section0;
    	let img1;
    	let img1_src_value;
    	let t14;
    	let p0;
    	let span1;
    	let t16;
    	let t17;
    	let p1;
    	let t19;
    	let section1;
    	let center0;
    	let div6;
    	let div3;
    	let img2;
    	let img2_src_value;
    	let t20;
    	let p2;
    	let t22;
    	let div4;
    	let img3;
    	let img3_src_value;
    	let t23;
    	let p3;
    	let t25;
    	let div5;
    	let img4;
    	let img4_src_value;
    	let t26;
    	let p4;
    	let t28;
    	let center1;
    	let div10;
    	let div7;
    	let img5;
    	let img5_src_value;
    	let t29;
    	let p5;
    	let t31;
    	let div8;
    	let img6;
    	let img6_src_value;
    	let t32;
    	let p6;
    	let t34;
    	let div9;
    	let img7;
    	let img7_src_value;
    	let t35;
    	let p7;
    	let t37;
    	let center2;
    	let div14;
    	let div11;
    	let img8;
    	let img8_src_value;
    	let t38;
    	let p8;
    	let t40;
    	let div12;
    	let img9;
    	let img9_src_value;
    	let t41;
    	let p9;
    	let t43;
    	let div13;
    	let img10;
    	let img10_src_value;
    	let t44;
    	let p10;
    	let t46;
    	let center3;
    	let div18;
    	let div15;
    	let img11;
    	let img11_src_value;
    	let t47;
    	let p11;
    	let t49;
    	let div16;
    	let img12;
    	let img12_src_value;
    	let t50;
    	let p12;
    	let t52;
    	let div17;
    	let img13;
    	let img13_src_value;
    	let t53;
    	let p13;
    	let t55;
    	let center4;
    	let div22;
    	let div19;
    	let img14;
    	let img14_src_value;
    	let t56;
    	let p14;
    	let t58;
    	let div20;
    	let img15;
    	let img15_src_value;
    	let t59;
    	let p15;
    	let t61;
    	let div21;
    	let img16;
    	let img16_src_value;
    	let t62;
    	let p16;
    	let t64;
    	let center5;
    	let div26;
    	let div23;
    	let img17;
    	let img17_src_value;
    	let t65;
    	let p17;
    	let t67;
    	let div24;
    	let img18;
    	let img18_src_value;
    	let t68;
    	let p18;
    	let t70;
    	let div25;
    	let img19;
    	let img19_src_value;
    	let t71;
    	let p19;
    	let t73;
    	let center6;
    	let div30;
    	let div27;
    	let img20;
    	let img20_src_value;
    	let t74;
    	let p20;
    	let t76;
    	let div28;
    	let img21;
    	let img21_src_value;
    	let t77;
    	let p21;
    	let t79;
    	let div29;
    	let img22;
    	let img22_src_value;
    	let t80;
    	let p22;
    	let t82;
    	let center7;
    	let div34;
    	let div31;
    	let img23;
    	let img23_src_value;
    	let t83;
    	let p23;
    	let t85;
    	let div32;
    	let img24;
    	let img24_src_value;
    	let t86;
    	let p24;
    	let t88;
    	let div33;
    	let img25;
    	let img25_src_value;
    	let t89;
    	let p25;
    	let t91;
    	let center8;
    	let div38;
    	let div35;
    	let img26;
    	let img26_src_value;
    	let t92;
    	let p26;
    	let t94;
    	let div36;
    	let img27;
    	let img27_src_value;
    	let t95;
    	let p27;
    	let t97;
    	let div37;
    	let img28;
    	let img28_src_value;
    	let t98;
    	let p28;
    	let t100;
    	let center9;
    	let div42;
    	let div39;
    	let img29;
    	let img29_src_value;
    	let t101;
    	let p29;
    	let t103;
    	let div40;
    	let img30;
    	let img30_src_value;
    	let t104;
    	let p30;
    	let t106;
    	let div41;
    	let img31;
    	let img31_src_value;
    	let t107;
    	let p31;
    	let t109;
    	let center10;
    	let div46;
    	let div43;
    	let img32;
    	let img32_src_value;
    	let t110;
    	let p32;
    	let t112;
    	let div44;
    	let img33;
    	let img33_src_value;
    	let t113;
    	let p33;
    	let t115;
    	let div45;
    	let img34;
    	let img34_src_value;
    	let t116;
    	let p34;
    	let t118;
    	let center11;
    	let div50;
    	let div47;
    	let img35;
    	let img35_src_value;
    	let t119;
    	let p35;
    	let t121;
    	let div48;
    	let img36;
    	let img36_src_value;
    	let t122;
    	let p36;
    	let t124;
    	let div49;
    	let img37;
    	let img37_src_value;
    	let t125;
    	let p37;
    	let t127;
    	let center12;
    	let div54;
    	let div51;
    	let img38;
    	let img38_src_value;
    	let t128;
    	let p38;
    	let t130;
    	let div52;
    	let img39;
    	let img39_src_value;
    	let t131;
    	let p39;
    	let t133;
    	let div53;
    	let img40;
    	let img40_src_value;
    	let t134;
    	let p40;
    	let t136;
    	let center13;
    	let div58;
    	let div55;
    	let img41;
    	let img41_src_value;
    	let t137;
    	let p41;
    	let t139;
    	let div56;
    	let img42;
    	let img42_src_value;
    	let t140;
    	let p42;
    	let t142;
    	let div57;
    	let img43;
    	let img43_src_value;
    	let t143;
    	let p43;
    	let t145;
    	let center14;
    	let div62;
    	let div59;
    	let img44;
    	let img44_src_value;
    	let t146;
    	let p44;
    	let t148;
    	let div60;
    	let img45;
    	let img45_src_value;
    	let t149;
    	let p45;
    	let t151;
    	let div61;
    	let img46;
    	let img46_src_value;
    	let t152;
    	let p46;
    	let t154;
    	let center15;
    	let div66;
    	let div63;
    	let img47;
    	let img47_src_value;
    	let t155;
    	let p47;
    	let t157;
    	let div64;
    	let img48;
    	let img48_src_value;
    	let t158;
    	let p48;
    	let t160;
    	let div65;
    	let img49;
    	let img49_src_value;
    	let t161;
    	let p49;
    	let t163;
    	let center16;
    	let div70;
    	let div67;
    	let img50;
    	let img50_src_value;
    	let t164;
    	let p50;
    	let t166;
    	let div68;
    	let img51;
    	let img51_src_value;
    	let t167;
    	let p51;
    	let t169;
    	let div69;
    	let img52;
    	let img52_src_value;
    	let t170;
    	let p52;
    	let t172;
    	let center17;
    	let div74;
    	let div71;
    	let img53;
    	let img53_src_value;
    	let t173;
    	let p53;
    	let t175;
    	let div72;
    	let img54;
    	let img54_src_value;
    	let t176;
    	let p54;
    	let t178;
    	let div73;
    	let img55;
    	let img55_src_value;
    	let t179;
    	let p55;
    	let t181;
    	let center18;
    	let div78;
    	let div75;
    	let img56;
    	let img56_src_value;
    	let t182;
    	let p56;
    	let t184;
    	let div76;
    	let img57;
    	let img57_src_value;
    	let t185;
    	let p57;
    	let t187;
    	let div77;
    	let img58;
    	let img58_src_value;
    	let t188;
    	let p58;
    	let t190;
    	let center19;
    	let div82;
    	let div79;
    	let img59;
    	let img59_src_value;
    	let t191;
    	let p59;
    	let t193;
    	let div80;
    	let img60;
    	let img60_src_value;
    	let t194;
    	let p60;
    	let t196;
    	let div81;
    	let img61;
    	let img61_src_value;
    	let t197;
    	let p61;
    	let t199;
    	let center20;
    	let div86;
    	let div83;
    	let img62;
    	let img62_src_value;
    	let t200;
    	let p62;
    	let t202;
    	let div84;
    	let img63;
    	let img63_src_value;
    	let t203;
    	let p63;
    	let t205;
    	let div85;
    	let img64;
    	let img64_src_value;
    	let t206;
    	let p64;
    	let t208;
    	let center21;
    	let div90;
    	let div87;
    	let img65;
    	let img65_src_value;
    	let t209;
    	let p65;
    	let t211;
    	let div88;
    	let img66;
    	let img66_src_value;
    	let t212;
    	let p66;
    	let t214;
    	let div89;
    	let img67;
    	let img67_src_value;
    	let t215;
    	let p67;
    	let t217;
    	let center22;
    	let div94;
    	let div91;
    	let img68;
    	let img68_src_value;
    	let t218;
    	let p68;
    	let t220;
    	let div92;
    	let img69;
    	let img69_src_value;
    	let t221;
    	let p69;
    	let t223;
    	let div93;
    	let img70;
    	let img70_src_value;
    	let t224;
    	let p70;
    	let t226;
    	let center23;
    	let div98;
    	let div95;
    	let img71;
    	let img71_src_value;
    	let t227;
    	let p71;
    	let t229;
    	let div96;
    	let img72;
    	let img72_src_value;
    	let t230;
    	let p72;
    	let t232;
    	let div97;
    	let img73;
    	let img73_src_value;
    	let t233;
    	let p73;
    	let t235;
    	let center24;
    	let div102;
    	let div99;
    	let img74;
    	let img74_src_value;
    	let t236;
    	let p74;
    	let t238;
    	let div100;
    	let img75;
    	let img75_src_value;
    	let t239;
    	let p75;
    	let t241;
    	let div101;
    	let img76;
    	let img76_src_value;
    	let t242;
    	let p76;
    	let t244;
    	let center25;
    	let div106;
    	let div103;
    	let img77;
    	let img77_src_value;
    	let t245;
    	let p77;
    	let t247;
    	let div104;
    	let img78;
    	let img78_src_value;
    	let t248;
    	let p78;
    	let t250;
    	let div105;
    	let img79;
    	let img79_src_value;
    	let t251;
    	let p79;
    	let t253;
    	let center26;
    	let div110;
    	let div107;
    	let img80;
    	let img80_src_value;
    	let t254;
    	let p80;
    	let t256;
    	let div108;
    	let img81;
    	let img81_src_value;
    	let t257;
    	let p81;
    	let t259;
    	let div109;
    	let img82;
    	let img82_src_value;
    	let t260;
    	let p82;
    	let t262;
    	let center27;
    	let div114;
    	let div111;
    	let img83;
    	let img83_src_value;
    	let t263;
    	let p83;
    	let t265;
    	let div112;
    	let img84;
    	let img84_src_value;
    	let t266;
    	let p84;
    	let t268;
    	let div113;
    	let img85;
    	let img85_src_value;
    	let t269;
    	let p85;
    	let t271;
    	let center28;
    	let div118;
    	let div115;
    	let img86;
    	let img86_src_value;
    	let t272;
    	let p86;
    	let t274;
    	let div116;
    	let img87;
    	let img87_src_value;
    	let t275;
    	let p87;
    	let t277;
    	let div117;
    	let img88;
    	let img88_src_value;
    	let t278;
    	let p88;
    	let t280;
    	let center29;
    	let div122;
    	let div119;
    	let img89;
    	let img89_src_value;
    	let t281;
    	let p89;
    	let t283;
    	let div120;
    	let img90;
    	let img90_src_value;
    	let t284;
    	let p90;
    	let t286;
    	let div121;
    	let img91;
    	let img91_src_value;
    	let t287;
    	let p91;
    	let t289;
    	let center30;
    	let div126;
    	let div123;
    	let img92;
    	let img92_src_value;
    	let t290;
    	let p92;
    	let t292;
    	let div124;
    	let img93;
    	let img93_src_value;
    	let t293;
    	let p93;
    	let t295;
    	let div125;
    	let img94;
    	let img94_src_value;
    	let t296;
    	let p94;
    	let t298;
    	let center31;
    	let div130;
    	let div127;
    	let img95;
    	let img95_src_value;
    	let t299;
    	let p95;
    	let t301;
    	let div128;
    	let img96;
    	let img96_src_value;
    	let t302;
    	let p96;
    	let t304;
    	let div129;
    	let img97;
    	let img97_src_value;
    	let t305;
    	let p97;
    	let t307;
    	let center32;
    	let div134;
    	let div131;
    	let img98;
    	let img98_src_value;
    	let t308;
    	let p98;
    	let t310;
    	let div132;
    	let img99;
    	let img99_src_value;
    	let t311;
    	let p99;
    	let t313;
    	let div133;
    	let img100;
    	let img100_src_value;
    	let t314;
    	let p100;
    	let t316;
    	let center33;
    	let div138;
    	let div135;
    	let img101;
    	let img101_src_value;
    	let t317;
    	let p101;
    	let t319;
    	let div136;
    	let img102;
    	let img102_src_value;
    	let t320;
    	let p102;
    	let t322;
    	let div137;
    	let img103;
    	let img103_src_value;
    	let t323;
    	let p103;
    	let t325;
    	let center34;
    	let div142;
    	let div139;
    	let img104;
    	let img104_src_value;
    	let t326;
    	let p104;
    	let t328;
    	let div140;
    	let img105;
    	let img105_src_value;
    	let t329;
    	let p105;
    	let t331;
    	let div141;
    	let img106;
    	let img106_src_value;
    	let t332;
    	let p106;
    	let t334;
    	let center35;
    	let div146;
    	let div143;
    	let img107;
    	let img107_src_value;
    	let t335;
    	let p107;
    	let t337;
    	let div144;
    	let img108;
    	let img108_src_value;
    	let t338;
    	let p108;
    	let t340;
    	let div145;
    	let img109;
    	let img109_src_value;
    	let t341;
    	let p109;
    	let t343;
    	let section2;
    	let div147;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t344;
    	let p110;
    	let t346;
    	let input;
    	let t347;
    	let p111;
    	let t349;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img0 = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span0 = element("span");
    			span0.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			section0 = element("section");
    			img1 = element("img");
    			t14 = space();
    			p0 = element("p");
    			span1 = element("span");
    			span1.textContent = "Add-On ";
    			t16 = text("Vehicles");
    			t17 = space();
    			p1 = element("p");
    			p1.textContent = "Welcome to the exhilarating world of FiveM's \"Barbaros\" add-on car! Buckle up and explore a vast fleet of over 150 meticulously crafted vehicles, \r\n            each offering unique thrills and customization options. \r\n            Unleash the power and conquer the streets with Barbaros' diverse collection of adrenaline-pumping rides! Also Barbaros RolePlay  offers players the ultimate freedom to select their \r\n            dream car on the GTA 5 Mods website. Check our discord Server for more details/informations about our companies";
    			t19 = space();
    			section1 = element("section");
    			center0 = element("center");
    			div6 = element("div");
    			div3 = element("div");
    			img2 = element("img");
    			t20 = space();
    			p2 = element("p");
    			p2.textContent = "zx10";
    			t22 = space();
    			div4 = element("div");
    			img3 = element("img");
    			t23 = space();
    			p3 = element("p");
    			p3.textContent = "zr3806str";
    			t25 = space();
    			div5 = element("div");
    			img4 = element("img");
    			t26 = space();
    			p4 = element("p");
    			p4.textContent = "z2879";
    			t28 = space();
    			center1 = element("center");
    			div10 = element("div");
    			div7 = element("div");
    			img5 = element("img");
    			t29 = space();
    			p5 = element("p");
    			p5.textContent = "z190custom";
    			t31 = space();
    			div8 = element("div");
    			img6 = element("img");
    			t32 = space();
    			p6 = element("p");
    			p6.textContent = "z32";
    			t34 = space();
    			div9 = element("div");
    			img7 = element("img");
    			t35 = space();
    			p7 = element("p");
    			p7.textContent = "yosemite6str";
    			t37 = space();
    			center2 = element("center");
    			div14 = element("div");
    			div11 = element("div");
    			img8 = element("img");
    			t38 = space();
    			p8 = element("p");
    			p8.textContent = "vulcan";
    			t40 = space();
    			div12 = element("div");
    			img9 = element("img");
    			t41 = space();
    			p9 = element("p");
    			p9.textContent = "victor";
    			t43 = space();
    			div13 = element("div");
    			img10 = element("img");
    			t44 = space();
    			p10 = element("p");
    			p10.textContent = "veln";
    			t46 = space();
    			center3 = element("center");
    			div18 = element("div");
    			div15 = element("div");
    			img11 = element("img");
    			t47 = space();
    			p11 = element("p");
    			p11.textContent = "v877";
    			t49 = space();
    			div16 = element("div");
    			img12 = element("img");
    			t50 = space();
    			p12 = element("p");
    			p12.textContent = "v242";
    			t52 = space();
    			div17 = element("div");
    			img13 = element("img");
    			t53 = space();
    			p13 = element("p");
    			p13.textContent = "uccoquette";
    			t55 = space();
    			center4 = element("center");
    			div22 = element("div");
    			div19 = element("div");
    			img14 = element("img");
    			t56 = space();
    			p14 = element("p");
    			p14.textContent = "tsgr20";
    			t58 = space();
    			div20 = element("div");
    			img15 = element("img");
    			t59 = space();
    			p15 = element("p");
    			p15.textContent = "tempesta2";
    			t61 = space();
    			div21 = element("div");
    			img16 = element("img");
    			t62 = space();
    			p16 = element("p");
    			p16.textContent = "tampa5";
    			t64 = space();
    			center5 = element("center");
    			div26 = element("div");
    			div23 = element("div");
    			img17 = element("img");
    			t65 = space();
    			p17 = element("p");
    			p17.textContent = "sultanrsv8";
    			t67 = space();
    			div24 = element("div");
    			img18 = element("img");
    			t68 = space();
    			p18 = element("p");
    			p18.textContent = "subwrx";
    			t70 = space();
    			div25 = element("div");
    			img19 = element("img");
    			t71 = space();
    			p19 = element("p");
    			p19.textContent = "stratumc";
    			t73 = space();
    			center6 = element("center");
    			div30 = element("div");
    			div27 = element("div");
    			img20 = element("img");
    			t74 = space();
    			p20 = element("p");
    			p20.textContent = "srt8b";
    			t76 = space();
    			div28 = element("div");
    			img21 = element("img");
    			t77 = space();
    			p21 = element("p");
    			p21.textContent = "sentinel6str2";
    			t79 = space();
    			div29 = element("div");
    			img22 = element("img");
    			t80 = space();
    			p22 = element("p");
    			p22.textContent = "senna";
    			t82 = space();
    			center7 = element("center");
    			div34 = element("div");
    			div31 = element("div");
    			img23 = element("img");
    			t83 = space();
    			p23 = element("p");
    			p23.textContent = "savanna";
    			t85 = space();
    			div32 = element("div");
    			img24 = element("img");
    			t86 = space();
    			p24 = element("p");
    			p24.textContent = "s15rb";
    			t88 = space();
    			div33 = element("div");
    			img25 = element("img");
    			t89 = space();
    			p25 = element("p");
    			p25.textContent = "s14boss";
    			t91 = space();
    			center8 = element("center");
    			div38 = element("div");
    			div35 = element("div");
    			img26 = element("img");
    			t92 = space();
    			p26 = element("p");
    			p26.textContent = "rx811";
    			t94 = space();
    			div36 = element("div");
    			img27 = element("img");
    			t95 = space();
    			p27 = element("p");
    			p27.textContent = "ruiner6str";
    			t97 = space();
    			div37 = element("div");
    			img28 = element("img");
    			t98 = space();
    			p28 = element("p");
    			p28.textContent = "rudiharley";
    			t100 = space();
    			center9 = element("center");
    			div42 = element("div");
    			div39 = element("div");
    			img29 = element("img");
    			t101 = space();
    			p29 = element("p");
    			p29.textContent = "rmodmustang";
    			t103 = space();
    			div40 = element("div");
    			img30 = element("img");
    			t104 = space();
    			p30 = element("p");
    			p30.textContent = "revolution6str2";
    			t106 = space();
    			div41 = element("div");
    			img31 = element("img");
    			t107 = space();
    			p31 = element("p");
    			p31.textContent = "rcf";
    			t109 = space();
    			center10 = element("center");
    			div46 = element("div");
    			div43 = element("div");
    			img32 = element("img");
    			t110 = space();
    			p32 = element("p");
    			p32.textContent = "raid";
    			t112 = space();
    			div44 = element("div");
    			img33 = element("img");
    			t113 = space();
    			p33 = element("p");
    			p33.textContent = "r35";
    			t115 = space();
    			div45 = element("div");
    			img34 = element("img");
    			t116 = space();
    			p34 = element("p");
    			p34.textContent = "r8h";
    			t118 = space();
    			center11 = element("center");
    			div50 = element("div");
    			div47 = element("div");
    			img35 = element("img");
    			t119 = space();
    			p35 = element("p");
    			p35.textContent = "22b";
    			t121 = space();
    			div48 = element("div");
    			img36 = element("img");
    			t122 = space();
    			p36 = element("p");
    			p36.textContent = "22g63";
    			t124 = space();
    			div49 = element("div");
    			img37 = element("img");
    			t125 = space();
    			p37 = element("p");
    			p37.textContent = "22m5";
    			t127 = space();
    			center12 = element("center");
    			div54 = element("div");
    			div51 = element("div");
    			img38 = element("img");
    			t128 = space();
    			p38 = element("p");
    			p38.textContent = "488misha";
    			t130 = space();
    			div52 = element("div");
    			img39 = element("img");
    			t131 = space();
    			p39 = element("p");
    			p39.textContent = "500gtrlam";
    			t133 = space();
    			div53 = element("div");
    			img40 = element("img");
    			t134 = space();
    			p40 = element("p");
    			p40.textContent = "675ltsp";
    			t136 = space();
    			center13 = element("center");
    			div58 = element("div");
    			div55 = element("div");
    			img41 = element("img");
    			t137 = space();
    			p41 = element("p");
    			p41.textContent = "720s";
    			t139 = space();
    			div56 = element("div");
    			img42 = element("img");
    			t140 = space();
    			p42 = element("p");
    			p42.textContent = "a6";
    			t142 = space();
    			div57 = element("div");
    			img43 = element("img");
    			t143 = space();
    			p43 = element("p");
    			p43.textContent = "a45amg";
    			t145 = space();
    			center14 = element("center");
    			div62 = element("div");
    			div59 = element("div");
    			img44 = element("img");
    			t146 = space();
    			p44 = element("p");
    			p44.textContent = "a80";
    			t148 = space();
    			div60 = element("div");
    			img45 = element("img");
    			t149 = space();
    			p45 = element("p");
    			p45.textContent = "bt62r";
    			t151 = space();
    			div61 = element("div");
    			img46 = element("img");
    			t152 = space();
    			p46 = element("p");
    			p46.textContent = "acr";
    			t154 = space();
    			center15 = element("center");
    			div66 = element("div");
    			div63 = element("div");
    			img47 = element("img");
    			t155 = space();
    			p47 = element("p");
    			p47.textContent = "acs8";
    			t157 = space();
    			div64 = element("div");
    			img48 = element("img");
    			t158 = space();
    			p48 = element("p");
    			p48.textContent = "asbo2";
    			t160 = space();
    			div65 = element("div");
    			img49 = element("img");
    			t161 = space();
    			p49 = element("p");
    			p49.textContent = "audirs6tk";
    			t163 = space();
    			center16 = element("center");
    			div70 = element("div");
    			div67 = element("div");
    			img50 = element("img");
    			t164 = space();
    			p50 = element("p");
    			p50.textContent = "bc";
    			t166 = space();
    			div68 = element("div");
    			img51 = element("img");
    			t167 = space();
    			p51 = element("p");
    			p51.textContent = "bdragon";
    			t169 = space();
    			div69 = element("div");
    			img52 = element("img");
    			t170 = space();
    			p52 = element("p");
    			p52.textContent = "bluecunt";
    			t172 = space();
    			center17 = element("center");
    			div74 = element("div");
    			div71 = element("div");
    			img53 = element("img");
    			t173 = space();
    			p53 = element("p");
    			p53.textContent = "bolide";
    			t175 = space();
    			div72 = element("div");
    			img54 = element("img");
    			t176 = space();
    			p54 = element("p");
    			p54.textContent = "C7";
    			t178 = space();
    			div73 = element("div");
    			img55 = element("img");
    			t179 = space();
    			p55 = element("p");
    			p55.textContent = "CGT";
    			t181 = space();
    			center18 = element("center");
    			div78 = element("div");
    			div75 = element("div");
    			img56 = element("img");
    			t182 = space();
    			p56 = element("p");
    			p56.textContent = "chiron17";
    			t184 = space();
    			div76 = element("div");
    			img57 = element("img");
    			t185 = space();
    			p57 = element("p");
    			p57.textContent = "cliors";
    			t187 = space();
    			div77 = element("div");
    			img58 = element("img");
    			t188 = space();
    			p58 = element("p");
    			p58.textContent = "contss18";
    			t190 = space();
    			center19 = element("center");
    			div82 = element("div");
    			div79 = element("div");
    			img59 = element("img");
    			t191 = space();
    			p59 = element("p");
    			p59.textContent = "cp9a";
    			t193 = space();
    			div80 = element("div");
    			img60 = element("img");
    			t194 = space();
    			p60 = element("p");
    			p60.textContent = "dabneon";
    			t196 = space();
    			div81 = element("div");
    			img61 = element("img");
    			t197 = space();
    			p61 = element("p");
    			p61.textContent = "db11";
    			t199 = space();
    			center20 = element("center");
    			div86 = element("div");
    			div83 = element("div");
    			img62 = element("img");
    			t200 = space();
    			p62 = element("p");
    			p62.textContent = "DC5";
    			t202 = space();
    			div84 = element("div");
    			img63 = element("img");
    			t203 = space();
    			p63 = element("p");
    			p63.textContent = "delsoleg";
    			t205 = space();
    			div85 = element("div");
    			img64 = element("img");
    			t206 = space();
    			p64 = element("p");
    			p64.textContent = "demon";
    			t208 = space();
    			center21 = element("center");
    			div90 = element("div");
    			div87 = element("div");
    			img65 = element("img");
    			t209 = space();
    			p65 = element("p");
    			p65.textContent = "divo";
    			t211 = space();
    			div88 = element("div");
    			img66 = element("img");
    			t212 = space();
    			p66 = element("p");
    			p66.textContent = "draftgpr";
    			t214 = space();
    			div89 = element("div");
    			img67 = element("img");
    			t215 = space();
    			p67 = element("p");
    			p67.textContent = "e36prb";
    			t217 = space();
    			center22 = element("center");
    			div94 = element("div");
    			div91 = element("div");
    			img68 = element("img");
    			t218 = space();
    			p68 = element("p");
    			p68.textContent = "ellie6str";
    			t220 = space();
    			div92 = element("div");
    			img69 = element("img");
    			t221 = space();
    			p69 = element("p");
    			p69.textContent = "evo9";
    			t223 = space();
    			div93 = element("div");
    			img70 = element("img");
    			t224 = space();
    			p70 = element("p");
    			p70.textContent = "f150";
    			t226 = space();
    			center23 = element("center");
    			div98 = element("div");
    			div95 = element("div");
    			img71 = element("img");
    			t227 = space();
    			p71 = element("p");
    			p71.textContent = "ffrs";
    			t229 = space();
    			div96 = element("div");
    			img72 = element("img");
    			t230 = space();
    			p72 = element("p");
    			p72.textContent = "filthynsx";
    			t232 = space();
    			div97 = element("div");
    			img73 = element("img");
    			t233 = space();
    			p73 = element("p");
    			p73.textContent = "FK8";
    			t235 = space();
    			center24 = element("center");
    			div102 = element("div");
    			div99 = element("div");
    			img74 = element("img");
    			t236 = space();
    			p74 = element("p");
    			p74.textContent = "fnf4r34";
    			t238 = space();
    			div100 = element("div");
    			img75 = element("img");
    			t239 = space();
    			p75 = element("p");
    			p75.textContent = "fnfrx7";
    			t241 = space();
    			div101 = element("div");
    			img76 = element("img");
    			t242 = space();
    			p76 = element("p");
    			p76.textContent = "fxxkevo";
    			t244 = space();
    			center25 = element("center");
    			div106 = element("div");
    			div103 = element("div");
    			img77 = element("img");
    			t245 = space();
    			p77 = element("p");
    			p77.textContent = "gauntlet6str";
    			t247 = space();
    			div104 = element("div");
    			img78 = element("img");
    			t248 = space();
    			p78 = element("p");
    			p78.textContent = "granlb";
    			t250 = space();
    			div105 = element("div");
    			img79 = element("img");
    			t251 = space();
    			p79 = element("p");
    			p79.textContent = "gt17";
    			t253 = space();
    			center26 = element("center");
    			div110 = element("div");
    			div107 = element("div");
    			img80 = element("img");
    			t254 = space();
    			p80 = element("p");
    			p80.textContent = "gt63";
    			t256 = space();
    			div108 = element("div");
    			img81 = element("img");
    			t257 = space();
    			p81 = element("p");
    			p81.textContent = "gt86";
    			t259 = space();
    			div109 = element("div");
    			img82 = element("img");
    			t260 = space();
    			p82 = element("p");
    			p82.textContent = "gtam21";
    			t262 = space();
    			center27 = element("center");
    			div114 = element("div");
    			div111 = element("div");
    			img83 = element("img");
    			t263 = space();
    			p83 = element("p");
    			p83.textContent = "gtr";
    			t265 = space();
    			div112 = element("div");
    			img84 = element("img");
    			t266 = space();
    			p84 = element("p");
    			p84.textContent = "gtrc";
    			t268 = space();
    			div113 = element("div");
    			img85 = element("img");
    			t269 = space();
    			p85 = element("p");
    			p85.textContent = "hoabrawler";
    			t271 = space();
    			center28 = element("center");
    			div118 = element("div");
    			div115 = element("div");
    			img86 = element("img");
    			t272 = space();
    			p86 = element("p");
    			p86.textContent = "JESKO2020";
    			t274 = space();
    			div116 = element("div");
    			img87 = element("img");
    			t275 = space();
    			p87 = element("p");
    			p87.textContent = "kiagt";
    			t277 = space();
    			div117 = element("div");
    			img88 = element("img");
    			t278 = space();
    			p88 = element("p");
    			p88.textContent = "ladybird6str";
    			t280 = space();
    			center29 = element("center");
    			div122 = element("div");
    			div119 = element("div");
    			img89 = element("img");
    			t281 = space();
    			p89 = element("p");
    			p89.textContent = "laferrari17";
    			t283 = space();
    			div120 = element("div");
    			img90 = element("img");
    			t284 = space();
    			p90 = element("p");
    			p90.textContent = "lc500";
    			t286 = space();
    			div121 = element("div");
    			img91 = element("img");
    			t287 = space();
    			p91 = element("p");
    			p91.textContent = "lfa";
    			t289 = space();
    			center30 = element("center");
    			div126 = element("div");
    			div123 = element("div");
    			img92 = element("img");
    			t290 = space();
    			p92 = element("p");
    			p92.textContent = "lp670";
    			t292 = space();
    			div124 = element("div");
    			img93 = element("img");
    			t293 = space();
    			p93 = element("p");
    			p93.textContent = "lp700";
    			t295 = space();
    			div125 = element("div");
    			img94 = element("img");
    			t296 = space();
    			p94 = element("p");
    			p94.textContent = "lpi8004";
    			t298 = space();
    			center31 = element("center");
    			div130 = element("div");
    			div127 = element("div");
    			img95 = element("img");
    			t299 = space();
    			p95 = element("p");
    			p95.textContent = "m2f22";
    			t301 = space();
    			div128 = element("div");
    			img96 = element("img");
    			t302 = space();
    			p96 = element("p");
    			p96.textContent = "m3e30";
    			t304 = space();
    			div129 = element("div");
    			img97 = element("img");
    			t305 = space();
    			p97 = element("p");
    			p97.textContent = "m3e46";
    			t307 = space();
    			center32 = element("center");
    			div134 = element("div");
    			div131 = element("div");
    			img98 = element("img");
    			t308 = space();
    			p98 = element("p");
    			p98.textContent = "m4";
    			t310 = space();
    			div132 = element("div");
    			img99 = element("img");
    			t311 = space();
    			p99 = element("p");
    			p99.textContent = "m5e60";
    			t313 = space();
    			div133 = element("div");
    			img100 = element("img");
    			t314 = space();
    			p100 = element("p");
    			p100.textContent = "maj350z";
    			t316 = space();
    			center33 = element("center");
    			div138 = element("div");
    			div135 = element("div");
    			img101 = element("img");
    			t317 = space();
    			p101 = element("p");
    			p101.textContent = "mbc63";
    			t319 = space();
    			div136 = element("div");
    			img102 = element("img");
    			t320 = space();
    			p102 = element("p");
    			p102.textContent = "na1";
    			t322 = space();
    			div137 = element("div");
    			img103 = element("img");
    			t323 = space();
    			p103 = element("p");
    			p103.textContent = "penumbra3";
    			t325 = space();
    			center34 = element("center");
    			div142 = element("div");
    			div139 = element("div");
    			img104 = element("img");
    			t326 = space();
    			p104 = element("p");
    			p104.textContent = "payneschaf";
    			t328 = space();
    			div140 = element("div");
    			img105 = element("img");
    			t329 = space();
    			p105 = element("p");
    			p105.textContent = "pgt322";
    			t331 = space();
    			div141 = element("div");
    			img106 = element("img");
    			t332 = space();
    			p106 = element("p");
    			p106.textContent = "por930";
    			t334 = space();
    			center35 = element("center");
    			div146 = element("div");
    			div143 = element("div");
    			img107 = element("img");
    			t335 = space();
    			p107 = element("p");
    			p107.textContent = "bmwr";
    			t337 = space();
    			div144 = element("div");
    			img108 = element("img");
    			t338 = space();
    			p108 = element("p");
    			p108.textContent = "deathbike2";
    			t340 = space();
    			div145 = element("div");
    			img109 = element("img");
    			t341 = space();
    			p109 = element("p");
    			p109.textContent = "r1";
    			t343 = space();
    			section2 = element("section");
    			div147 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t344 = space();
    			p110 = element("p");
    			p110.textContent = "Connect Via IP:";
    			t346 = space();
    			input = element("input");
    			t347 = space();
    			p111 = element("p");
    			p111.textContent = "OR";
    			t349 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img0.src, img0_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img0, "src", img0_src_value);
    			attr_dev(img0, "class", "h-14 mr-3 mt-1");
    			attr_dev(img0, "alt", "Barbaros Logo");
    			add_location(img0, file$g, 26, 8, 896);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$g, 25, 4, 848);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$g, 29, 8, 1039);
    			attr_dev(span0, "class", "sr-only");
    			add_location(span0, file$g, 31, 8, 1647);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$g, 33, 8, 1817);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$g, 32, 8, 1700);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$g, 30, 8, 1290);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$g, 28, 4, 1000);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$g, 41, 8, 2278);
    			add_location(li0, file$g, 39, 8, 2209);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$g, 44, 8, 2385);
    			add_location(li1, file$g, 43, 8, 2371);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$g, 47, 12, 2517);
    			add_location(li2, file$g, 46, 8, 2499);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$g, 50, 8, 2635);
    			add_location(li3, file$g, 49, 8, 2621);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$g, 38, 4, 2093);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$g, 37, 4, 1986);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$g, 24, 4, 757);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$g, 23, 4, 679);
    			if (!src_url_equal(img1.src, img1_src_value = "/assets/img/left-fly-community.png")) attr_dev(img1, "src", img1_src_value);
    			attr_dev(img1, "alt", "Object");
    			attr_dev(img1, "class", "absolute right-0");
    			add_location(img1, file$g, 58, 8, 2866);
    			attr_dev(span1, "class", "text-[#7C5BF1]");
    			add_location(span1, file$g, 59, 53, 3005);
    			attr_dev(p0, "class", "text-5xl font-bold text-[#2F344F]");
    			add_location(p0, file$g, 59, 8, 2960);
    			attr_dev(p1, "class", "text-lg mt-4 text-[#2F344F] text-center w-2/4");
    			add_location(p1, file$g, 60, 8, 3070);
    			attr_dev(section0, "class", "flex flex-col items-center relative mt-8");
    			add_location(section0, file$g, 57, 0, 2798);
    			if (!src_url_equal(img2.src, img2_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134493504865841212/image.png?width=642&height=562")) attr_dev(img2, "src", img2_src_value);
    			set_style(img2, "border-radius", "10px");
    			set_style(img2, "width", "490px");
    			set_style(img2, "height", "320px");
    			add_location(img2, file$g, 72, 10, 4006);
    			attr_dev(p2, "id", "ped-name");
    			set_style(p2, "text-align", "center");
    			attr_dev(p2, "class", "svelte-vym9k4");
    			add_location(p2, file$g, 73, 10, 4199);
    			add_location(div3, file$g, 70, 8, 3930);
    			if (!src_url_equal(img3.src, img3_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134493800178397245/image.png")) attr_dev(img3, "src", img3_src_value);
    			set_style(img3, "border-radius", "10px");
    			set_style(img3, "width", "490px");
    			set_style(img3, "height", "320px");
    			add_location(img3, file$g, 77, 10, 4354);
    			attr_dev(p3, "id", "ped-name");
    			set_style(p3, "text-align", "center");
    			attr_dev(p3, "class", "svelte-vym9k4");
    			add_location(p3, file$g, 78, 10, 4526);
    			add_location(div4, file$g, 75, 8, 4280);
    			if (!src_url_equal(img4.src, img4_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134494094408814752/image.png?width=810&height=481")) attr_dev(img4, "src", img4_src_value);
    			set_style(img4, "border-radius", "10px");
    			set_style(img4, "width", "490px");
    			set_style(img4, "height", "320px");
    			add_location(img4, file$g, 82, 10, 4684);
    			attr_dev(p4, "id", "ped-name");
    			set_style(p4, "text-align", "center");
    			attr_dev(p4, "class", "svelte-vym9k4");
    			add_location(p4, file$g, 83, 10, 4878);
    			add_location(div5, file$g, 80, 8, 4610);
    			attr_dev(div6, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ;");
    			add_location(div6, file$g, 69, 12, 3841);
    			add_location(center0, file$g, 69, 4, 3833);
    			if (!src_url_equal(img5.src, img5_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134494335300280340/image.png")) attr_dev(img5, "src", img5_src_value);
    			set_style(img5, "border-radius", "10px");
    			set_style(img5, "width", "490px");
    			set_style(img5, "height", "320px");
    			add_location(img5, file$g, 89, 14, 5172);
    			attr_dev(p5, "id", "ped-name");
    			set_style(p5, "text-align", "center");
    			attr_dev(p5, "class", "svelte-vym9k4");
    			add_location(p5, file$g, 90, 14, 5348);
    			add_location(div7, file$g, 87, 12, 5088);
    			if (!src_url_equal(img6.src, img6_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134494631355236473/image.png")) attr_dev(img6, "src", img6_src_value);
    			set_style(img6, "border-radius", "10px");
    			set_style(img6, "width", "490px");
    			set_style(img6, "height", "320px");
    			add_location(img6, file$g, 94, 14, 5526);
    			attr_dev(p6, "id", "ped-name");
    			set_style(p6, "text-align", "center");
    			attr_dev(p6, "class", "svelte-vym9k4");
    			add_location(p6, file$g, 95, 14, 5702);
    			add_location(div8, file$g, 92, 12, 5444);
    			if (!src_url_equal(img7.src, img7_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134494826059006012/image.png?width=810&height=502")) attr_dev(img7, "src", img7_src_value);
    			set_style(img7, "border-radius", "10px");
    			set_style(img7, "width", "490px");
    			set_style(img7, "height", "320px");
    			add_location(img7, file$g, 99, 14, 5871);
    			attr_dev(p7, "id", "ped-name");
    			set_style(p7, "text-align", "center");
    			attr_dev(p7, "class", "svelte-vym9k4");
    			add_location(p7, file$g, 100, 14, 6069);
    			add_location(div9, file$g, 97, 12, 5789);
    			attr_dev(div10, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div10, file$g, 86, 16, 4977);
    			add_location(center1, file$g, 86, 8, 4969);
    			if (!src_url_equal(img8.src, img8_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134495119450570864/image.png?width=810&height=487")) attr_dev(img8, "src", img8_src_value);
    			set_style(img8, "border-radius", "10px");
    			set_style(img8, "width", "490px");
    			set_style(img8, "height", "320px");
    			add_location(img8, file$g, 106, 14, 6370);
    			attr_dev(p8, "id", "ped-name");
    			set_style(p8, "text-align", "center");
    			attr_dev(p8, "class", "svelte-vym9k4");
    			add_location(p8, file$g, 107, 14, 6567);
    			add_location(div11, file$g, 104, 12, 6286);
    			if (!src_url_equal(img9.src, img9_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134495355652817047/image.png?width=810&height=510")) attr_dev(img9, "src", img9_src_value);
    			set_style(img9, "border-radius", "10px");
    			set_style(img9, "width", "490px");
    			set_style(img9, "height", "320px");
    			add_location(img9, file$g, 111, 14, 6741);
    			attr_dev(p9, "id", "ped-name");
    			set_style(p9, "text-align", "center");
    			attr_dev(p9, "class", "svelte-vym9k4");
    			add_location(p9, file$g, 112, 14, 6938);
    			add_location(div12, file$g, 109, 12, 6659);
    			if (!src_url_equal(img10.src, img10_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134495697748643952/image.png?width=810&height=515")) attr_dev(img10, "src", img10_src_value);
    			set_style(img10, "border-radius", "10px");
    			set_style(img10, "width", "490px");
    			set_style(img10, "height", "320px");
    			add_location(img10, file$g, 116, 14, 7110);
    			attr_dev(p10, "id", "ped-name");
    			set_style(p10, "text-align", "center");
    			attr_dev(p10, "class", "svelte-vym9k4");
    			add_location(p10, file$g, 117, 14, 7308);
    			add_location(div13, file$g, 114, 12, 7028);
    			attr_dev(div14, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div14, file$g, 103, 16, 6175);
    			add_location(center2, file$g, 103, 8, 6167);
    			if (!src_url_equal(img11.src, img11_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134496148065878066/image.png?width=810&height=458")) attr_dev(img11, "src", img11_src_value);
    			set_style(img11, "border-radius", "10px");
    			set_style(img11, "width", "490px");
    			set_style(img11, "height", "320px");
    			add_location(img11, file$g, 122, 14, 7599);
    			attr_dev(p11, "id", "ped-name");
    			set_style(p11, "text-align", "center");
    			attr_dev(p11, "class", "svelte-vym9k4");
    			add_location(p11, file$g, 123, 14, 7796);
    			add_location(div15, file$g, 120, 12, 7515);
    			if (!src_url_equal(img12.src, img12_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134496365372780655/image.png?width=810&height=442")) attr_dev(img12, "src", img12_src_value);
    			set_style(img12, "border-radius", "10px");
    			set_style(img12, "width", "490px");
    			set_style(img12, "height", "320px");
    			add_location(img12, file$g, 127, 14, 7968);
    			attr_dev(p12, "id", "ped-name");
    			set_style(p12, "text-align", "center");
    			attr_dev(p12, "class", "svelte-vym9k4");
    			add_location(p12, file$g, 128, 14, 8165);
    			add_location(div16, file$g, 125, 12, 7886);
    			if (!src_url_equal(img13.src, img13_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134496602225131570/image.png?width=810&height=412")) attr_dev(img13, "src", img13_src_value);
    			set_style(img13, "border-radius", "10px");
    			set_style(img13, "width", "490px");
    			set_style(img13, "height", "320px");
    			add_location(img13, file$g, 132, 14, 8335);
    			attr_dev(p13, "id", "ped-name");
    			set_style(p13, "text-align", "center");
    			attr_dev(p13, "class", "svelte-vym9k4");
    			add_location(p13, file$g, 133, 14, 8533);
    			add_location(div17, file$g, 130, 12, 8253);
    			attr_dev(div18, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div18, file$g, 119, 16, 7404);
    			add_location(center3, file$g, 119, 8, 7396);
    			if (!src_url_equal(img14.src, img14_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134496845092094123/image.png?width=810&height=437")) attr_dev(img14, "src", img14_src_value);
    			set_style(img14, "border-radius", "10px");
    			set_style(img14, "width", "490px");
    			set_style(img14, "height", "320px");
    			add_location(img14, file$g, 140, 14, 8834);
    			attr_dev(p14, "id", "ped-name");
    			set_style(p14, "text-align", "center");
    			attr_dev(p14, "class", "svelte-vym9k4");
    			add_location(p14, file$g, 141, 14, 9031);
    			add_location(div19, file$g, 138, 12, 8750);
    			if (!src_url_equal(img15.src, img15_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134497162932269137/image.png?width=810&height=462")) attr_dev(img15, "src", img15_src_value);
    			set_style(img15, "border-radius", "10px");
    			set_style(img15, "width", "490px");
    			set_style(img15, "height", "320px");
    			add_location(img15, file$g, 145, 14, 9205);
    			attr_dev(p15, "id", "ped-name");
    			set_style(p15, "text-align", "center");
    			attr_dev(p15, "class", "svelte-vym9k4");
    			add_location(p15, file$g, 146, 14, 9402);
    			add_location(div20, file$g, 143, 12, 9123);
    			if (!src_url_equal(img16.src, img16_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134497388984283317/image.png?width=810&height=420")) attr_dev(img16, "src", img16_src_value);
    			set_style(img16, "border-radius", "10px");
    			set_style(img16, "width", "490px");
    			set_style(img16, "height", "320px");
    			add_location(img16, file$g, 150, 14, 9577);
    			attr_dev(p16, "id", "ped-name");
    			set_style(p16, "text-align", "center");
    			attr_dev(p16, "class", "svelte-vym9k4");
    			add_location(p16, file$g, 151, 14, 9775);
    			add_location(div21, file$g, 148, 12, 9495);
    			attr_dev(div22, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div22, file$g, 137, 16, 8639);
    			add_location(center4, file$g, 137, 8, 8631);
    			if (!src_url_equal(img17.src, img17_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134497670178803732/image.png?width=810&height=459")) attr_dev(img17, "src", img17_src_value);
    			set_style(img17, "border-radius", "10px");
    			set_style(img17, "width", "490px");
    			set_style(img17, "height", "320px");
    			add_location(img17, file$g, 157, 14, 10070);
    			attr_dev(p17, "id", "ped-name");
    			set_style(p17, "text-align", "center");
    			attr_dev(p17, "class", "svelte-vym9k4");
    			add_location(p17, file$g, 158, 14, 10267);
    			add_location(div23, file$g, 155, 12, 9986);
    			if (!src_url_equal(img18.src, img18_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134497951151038555/image.png?width=810&height=494")) attr_dev(img18, "src", img18_src_value);
    			set_style(img18, "border-radius", "10px");
    			set_style(img18, "width", "490px");
    			set_style(img18, "height", "320px");
    			add_location(img18, file$g, 162, 14, 10445);
    			attr_dev(p18, "id", "ped-name");
    			set_style(p18, "text-align", "center");
    			attr_dev(p18, "class", "svelte-vym9k4");
    			add_location(p18, file$g, 163, 14, 10642);
    			add_location(div24, file$g, 160, 12, 10363);
    			if (!src_url_equal(img19.src, img19_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134498162795630662/image.png?width=810&height=445")) attr_dev(img19, "src", img19_src_value);
    			set_style(img19, "border-radius", "10px");
    			set_style(img19, "width", "490px");
    			set_style(img19, "height", "320px");
    			add_location(img19, file$g, 167, 14, 10814);
    			attr_dev(p19, "id", "ped-name");
    			set_style(p19, "text-align", "center");
    			attr_dev(p19, "class", "svelte-vym9k4");
    			add_location(p19, file$g, 168, 14, 11012);
    			add_location(div25, file$g, 165, 12, 10732);
    			attr_dev(div26, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div26, file$g, 154, 16, 9875);
    			add_location(center5, file$g, 154, 8, 9867);
    			if (!src_url_equal(img20.src, img20_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134498391813005444/image.png?width=810&height=504")) attr_dev(img20, "src", img20_src_value);
    			set_style(img20, "border-radius", "10px");
    			set_style(img20, "width", "490px");
    			set_style(img20, "height", "320px");
    			add_location(img20, file$g, 174, 14, 11309);
    			attr_dev(p20, "id", "ped-name");
    			set_style(p20, "text-align", "center");
    			attr_dev(p20, "class", "svelte-vym9k4");
    			add_location(p20, file$g, 175, 14, 11506);
    			add_location(div27, file$g, 172, 12, 11225);
    			if (!src_url_equal(img21.src, img21_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134498672848146522/image.png?width=810&height=467")) attr_dev(img21, "src", img21_src_value);
    			set_style(img21, "border-radius", "10px");
    			set_style(img21, "width", "490px");
    			set_style(img21, "height", "320px");
    			add_location(img21, file$g, 179, 14, 11679);
    			attr_dev(p21, "id", "ped-name");
    			set_style(p21, "text-align", "center");
    			attr_dev(p21, "class", "svelte-vym9k4");
    			add_location(p21, file$g, 180, 14, 11876);
    			add_location(div28, file$g, 177, 12, 11597);
    			if (!src_url_equal(img22.src, img22_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134498830952439838/image.png")) attr_dev(img22, "src", img22_src_value);
    			set_style(img22, "border-radius", "10px");
    			set_style(img22, "width", "490px");
    			set_style(img22, "height", "320px");
    			add_location(img22, file$g, 184, 14, 12055);
    			attr_dev(p22, "id", "ped-name");
    			set_style(p22, "text-align", "center");
    			attr_dev(p22, "class", "svelte-vym9k4");
    			add_location(p22, file$g, 185, 14, 12232);
    			add_location(div29, file$g, 182, 12, 11973);
    			attr_dev(div30, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div30, file$g, 171, 16, 11114);
    			add_location(center6, file$g, 171, 8, 11106);
    			if (!src_url_equal(img23.src, img23_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134499006328864870/image.png?width=810&height=475")) attr_dev(img23, "src", img23_src_value);
    			set_style(img23, "border-radius", "10px");
    			set_style(img23, "width", "490px");
    			set_style(img23, "height", "320px");
    			add_location(img23, file$g, 191, 14, 12526);
    			attr_dev(p23, "id", "ped-name");
    			set_style(p23, "text-align", "center");
    			attr_dev(p23, "class", "svelte-vym9k4");
    			add_location(p23, file$g, 192, 14, 12723);
    			add_location(div31, file$g, 189, 12, 12442);
    			if (!src_url_equal(img24.src, img24_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134499268573528134/image.png?width=810&height=428")) attr_dev(img24, "src", img24_src_value);
    			set_style(img24, "border-radius", "10px");
    			set_style(img24, "width", "490px");
    			set_style(img24, "height", "320px");
    			add_location(img24, file$g, 196, 14, 12898);
    			attr_dev(p24, "id", "ped-name");
    			set_style(p24, "text-align", "center");
    			attr_dev(p24, "class", "svelte-vym9k4");
    			add_location(p24, file$g, 197, 14, 13095);
    			add_location(div32, file$g, 194, 12, 12816);
    			if (!src_url_equal(img25.src, img25_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134499472299278366/image.png?width=810&height=464")) attr_dev(img25, "src", img25_src_value);
    			set_style(img25, "border-radius", "10px");
    			set_style(img25, "width", "490px");
    			set_style(img25, "height", "320px");
    			add_location(img25, file$g, 201, 14, 13266);
    			attr_dev(p25, "id", "ped-name");
    			set_style(p25, "text-align", "center");
    			attr_dev(p25, "class", "svelte-vym9k4");
    			add_location(p25, file$g, 202, 14, 13464);
    			add_location(div33, file$g, 199, 12, 13184);
    			attr_dev(div34, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div34, file$g, 188, 16, 12331);
    			add_location(center7, file$g, 188, 8, 12323);
    			if (!src_url_equal(img26.src, img26_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134499742404063302/image.png?width=810&height=443")) attr_dev(img26, "src", img26_src_value);
    			set_style(img26, "border-radius", "10px");
    			set_style(img26, "width", "490px");
    			set_style(img26, "height", "320px");
    			add_location(img26, file$g, 209, 14, 13762);
    			attr_dev(p26, "id", "ped-name");
    			set_style(p26, "text-align", "center");
    			attr_dev(p26, "class", "svelte-vym9k4");
    			add_location(p26, file$g, 210, 14, 13959);
    			add_location(div35, file$g, 207, 12, 13678);
    			if (!src_url_equal(img27.src, img27_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134499929373544468/image.png?width=810&height=435")) attr_dev(img27, "src", img27_src_value);
    			set_style(img27, "border-radius", "10px");
    			set_style(img27, "width", "490px");
    			set_style(img27, "height", "320px");
    			add_location(img27, file$g, 214, 14, 14132);
    			attr_dev(p27, "id", "ped-name");
    			set_style(p27, "text-align", "center");
    			attr_dev(p27, "class", "svelte-vym9k4");
    			add_location(p27, file$g, 215, 14, 14329);
    			add_location(div36, file$g, 212, 12, 14050);
    			if (!src_url_equal(img28.src, img28_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134500085347127357/image.png")) attr_dev(img28, "src", img28_src_value);
    			set_style(img28, "border-radius", "10px");
    			set_style(img28, "width", "490px");
    			set_style(img28, "height", "320px");
    			add_location(img28, file$g, 219, 14, 14505);
    			attr_dev(p28, "id", "ped-name");
    			set_style(p28, "text-align", "center");
    			attr_dev(p28, "class", "svelte-vym9k4");
    			add_location(p28, file$g, 220, 14, 14682);
    			add_location(div37, file$g, 217, 12, 14423);
    			attr_dev(div38, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div38, file$g, 206, 16, 13567);
    			add_location(center8, file$g, 206, 8, 13559);
    			if (!src_url_equal(img29.src, img29_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134500387374764154/image.png?width=810&height=447")) attr_dev(img29, "src", img29_src_value);
    			set_style(img29, "border-radius", "10px");
    			set_style(img29, "width", "490px");
    			set_style(img29, "height", "320px");
    			add_location(img29, file$g, 226, 14, 14981);
    			attr_dev(p29, "id", "ped-name");
    			set_style(p29, "text-align", "center");
    			attr_dev(p29, "class", "svelte-vym9k4");
    			add_location(p29, file$g, 227, 14, 15178);
    			add_location(div39, file$g, 224, 12, 14897);
    			if (!src_url_equal(img30.src, img30_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134500564407963688/image.png")) attr_dev(img30, "src", img30_src_value);
    			set_style(img30, "border-radius", "10px");
    			set_style(img30, "width", "490px");
    			set_style(img30, "height", "320px");
    			add_location(img30, file$g, 231, 14, 15357);
    			attr_dev(p30, "id", "ped-name");
    			set_style(p30, "text-align", "center");
    			attr_dev(p30, "class", "svelte-vym9k4");
    			add_location(p30, file$g, 232, 14, 15533);
    			add_location(div40, file$g, 229, 12, 15275);
    			if (!src_url_equal(img31.src, img31_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134500725632815244/image.png")) attr_dev(img31, "src", img31_src_value);
    			set_style(img31, "border-radius", "10px");
    			set_style(img31, "width", "490px");
    			set_style(img31, "height", "320px");
    			add_location(img31, file$g, 236, 14, 15726);
    			attr_dev(p31, "id", "ped-name");
    			set_style(p31, "text-align", "center");
    			attr_dev(p31, "class", "svelte-vym9k4");
    			add_location(p31, file$g, 237, 14, 15903);
    			add_location(div41, file$g, 234, 12, 15644);
    			attr_dev(div42, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div42, file$g, 223, 16, 14786);
    			add_location(center9, file$g, 223, 8, 14778);
    			if (!src_url_equal(img32.src, img32_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134500921808797807/image.png?width=810&height=451")) attr_dev(img32, "src", img32_src_value);
    			set_style(img32, "border-radius", "10px");
    			set_style(img32, "width", "490px");
    			set_style(img32, "height", "320px");
    			add_location(img32, file$g, 243, 14, 16195);
    			attr_dev(p32, "id", "ped-name");
    			set_style(p32, "text-align", "center");
    			attr_dev(p32, "class", "svelte-vym9k4");
    			add_location(p32, file$g, 244, 14, 16392);
    			add_location(div43, file$g, 241, 12, 16111);
    			if (!src_url_equal(img33.src, img33_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134501137341485097/image.png")) attr_dev(img33, "src", img33_src_value);
    			set_style(img33, "border-radius", "10px");
    			set_style(img33, "width", "490px");
    			set_style(img33, "height", "320px");
    			add_location(img33, file$g, 248, 14, 16564);
    			attr_dev(p33, "id", "ped-name");
    			set_style(p33, "text-align", "center");
    			attr_dev(p33, "class", "svelte-vym9k4");
    			add_location(p33, file$g, 249, 14, 16740);
    			add_location(div44, file$g, 246, 12, 16482);
    			if (!src_url_equal(img34.src, img34_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134501381135417394/image.png?width=810&height=455")) attr_dev(img34, "src", img34_src_value);
    			set_style(img34, "border-radius", "10px");
    			set_style(img34, "width", "490px");
    			set_style(img34, "height", "320px");
    			add_location(img34, file$g, 253, 14, 16909);
    			attr_dev(p34, "id", "ped-name");
    			set_style(p34, "text-align", "center");
    			attr_dev(p34, "class", "svelte-vym9k4");
    			add_location(p34, file$g, 254, 14, 17107);
    			add_location(div45, file$g, 251, 12, 16827);
    			attr_dev(div46, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div46, file$g, 240, 16, 16000);
    			add_location(center10, file$g, 240, 8, 15992);
    			if (!src_url_equal(img35.src, img35_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134703861781770280/image.png?width=810&height=521")) attr_dev(img35, "src", img35_src_value);
    			set_style(img35, "border-radius", "10px");
    			set_style(img35, "width", "490px");
    			set_style(img35, "height", "320px");
    			add_location(img35, file$g, 261, 12, 17395);
    			attr_dev(p35, "id", "ped-name");
    			set_style(p35, "text-align", "center");
    			attr_dev(p35, "class", "svelte-vym9k4");
    			add_location(p35, file$g, 262, 12, 17590);
    			add_location(div47, file$g, 259, 10, 17315);
    			if (!src_url_equal(img36.src, img36_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134704264397201499/image.png?width=810&height=474")) attr_dev(img36, "src", img36_src_value);
    			set_style(img36, "border-radius", "10px");
    			set_style(img36, "width", "490px");
    			set_style(img36, "height", "320px");
    			add_location(img36, file$g, 266, 12, 17753);
    			attr_dev(p36, "id", "ped-name");
    			set_style(p36, "text-align", "center");
    			attr_dev(p36, "class", "svelte-vym9k4");
    			add_location(p36, file$g, 267, 12, 17948);
    			add_location(div48, file$g, 264, 10, 17675);
    			if (!src_url_equal(img37.src, img37_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134704615913422848/image.png?width=810&height=554")) attr_dev(img37, "src", img37_src_value);
    			set_style(img37, "border-radius", "10px");
    			set_style(img37, "width", "490px");
    			set_style(img37, "height", "320px");
    			add_location(img37, file$g, 271, 12, 18111);
    			attr_dev(p37, "id", "ped-name");
    			set_style(p37, "text-align", "center");
    			attr_dev(p37, "class", "svelte-vym9k4");
    			add_location(p37, file$g, 272, 12, 18307);
    			add_location(div49, file$g, 269, 10, 18033);
    			attr_dev(div50, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div50, file$g, 258, 16, 17206);
    			add_location(center11, file$g, 258, 8, 17198);
    			if (!src_url_equal(img38.src, img38_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134779778424119396/image.png?width=810&height=447")) attr_dev(img38, "src", img38_src_value);
    			set_style(img38, "border-radius", "10px");
    			set_style(img38, "width", "490px");
    			set_style(img38, "height", "320px");
    			add_location(img38, file$g, 278, 10, 18584);
    			attr_dev(p38, "id", "ped-name");
    			set_style(p38, "text-align", "center");
    			attr_dev(p38, "class", "svelte-vym9k4");
    			add_location(p38, file$g, 279, 10, 18777);
    			add_location(div51, file$g, 276, 8, 18508);
    			if (!src_url_equal(img39.src, img39_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134780016547344404/image.png?width=810&height=459")) attr_dev(img39, "src", img39_src_value);
    			set_style(img39, "border-radius", "10px");
    			set_style(img39, "width", "490px");
    			set_style(img39, "height", "320px");
    			add_location(img39, file$g, 283, 10, 18937);
    			attr_dev(p39, "id", "ped-name");
    			set_style(p39, "text-align", "center");
    			attr_dev(p39, "class", "svelte-vym9k4");
    			add_location(p39, file$g, 284, 10, 19130);
    			add_location(div52, file$g, 281, 8, 18863);
    			if (!src_url_equal(img40.src, img40_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134780446589341807/image.png?width=810&height=435")) attr_dev(img40, "src", img40_src_value);
    			set_style(img40, "border-radius", "10px");
    			set_style(img40, "width", "490px");
    			set_style(img40, "height", "320px");
    			add_location(img40, file$g, 288, 10, 19289);
    			attr_dev(p40, "id", "ped-name");
    			set_style(p40, "text-align", "center");
    			attr_dev(p40, "class", "svelte-vym9k4");
    			add_location(p40, file$g, 289, 10, 19483);
    			add_location(div53, file$g, 286, 8, 19215);
    			attr_dev(div54, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div54, file$g, 275, 14, 18401);
    			add_location(center12, file$g, 275, 6, 18393);
    			if (!src_url_equal(img41.src, img41_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134706503442518158/image.png?width=810&height=500")) attr_dev(img41, "src", img41_src_value);
    			set_style(img41, "border-radius", "10px");
    			set_style(img41, "width", "490px");
    			set_style(img41, "height", "320px");
    			add_location(img41, file$g, 295, 8, 19753);
    			attr_dev(p41, "id", "ped-name");
    			set_style(p41, "text-align", "center");
    			attr_dev(p41, "class", "svelte-vym9k4");
    			add_location(p41, file$g, 296, 8, 19944);
    			add_location(div55, file$g, 293, 6, 19681);
    			if (!src_url_equal(img42.src, img42_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134706745885855744/image.png?width=810&height=523")) attr_dev(img42, "src", img42_src_value);
    			set_style(img42, "border-radius", "10px");
    			set_style(img42, "width", "490px");
    			set_style(img42, "height", "320px");
    			add_location(img42, file$g, 300, 8, 20092);
    			attr_dev(p42, "id", "ped-name");
    			set_style(p42, "text-align", "center");
    			attr_dev(p42, "class", "svelte-vym9k4");
    			add_location(p42, file$g, 301, 8, 20283);
    			add_location(div56, file$g, 298, 6, 20022);
    			if (!src_url_equal(img43.src, img43_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134707319884763186/image.png?width=810&height=548")) attr_dev(img43, "src", img43_src_value);
    			set_style(img43, "border-radius", "10px");
    			set_style(img43, "width", "490px");
    			set_style(img43, "height", "320px");
    			add_location(img43, file$g, 305, 8, 20427);
    			attr_dev(p43, "id", "ped-name");
    			set_style(p43, "text-align", "center");
    			attr_dev(p43, "class", "svelte-vym9k4");
    			add_location(p43, file$g, 306, 8, 20619);
    			add_location(div57, file$g, 303, 6, 20357);
    			attr_dev(div58, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div58, file$g, 292, 12, 19576);
    			add_location(center13, file$g, 292, 4, 19568);
    			if (!src_url_equal(img44.src, img44_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134781522365403187/image.png?width=810&height=409")) attr_dev(img44, "src", img44_src_value);
    			set_style(img44, "border-radius", "10px");
    			set_style(img44, "width", "490px");
    			set_style(img44, "height", "320px");
    			add_location(img44, file$g, 312, 6, 20878);
    			attr_dev(p44, "id", "ped-name");
    			set_style(p44, "text-align", "center");
    			attr_dev(p44, "class", "svelte-vym9k4");
    			add_location(p44, file$g, 313, 6, 21067);
    			add_location(div59, file$g, 310, 4, 20810);
    			if (!src_url_equal(img45.src, img45_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134781674681548860/image.png?width=810&height=445")) attr_dev(img45, "src", img45_src_value);
    			set_style(img45, "border-radius", "10px");
    			set_style(img45, "width", "490px");
    			set_style(img45, "height", "320px");
    			add_location(img45, file$g, 317, 6, 21206);
    			attr_dev(p45, "id", "ped-name");
    			set_style(p45, "text-align", "center");
    			attr_dev(p45, "class", "svelte-vym9k4");
    			add_location(p45, file$g, 318, 6, 21395);
    			add_location(div60, file$g, 315, 4, 21140);
    			if (!src_url_equal(img46.src, img46_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134781872891772928/image.png?width=810&height=444")) attr_dev(img46, "src", img46_src_value);
    			set_style(img46, "border-radius", "10px");
    			set_style(img46, "width", "490px");
    			set_style(img46, "height", "320px");
    			add_location(img46, file$g, 322, 6, 21534);
    			attr_dev(p46, "id", "ped-name");
    			set_style(p46, "text-align", "center");
    			attr_dev(p46, "class", "svelte-vym9k4");
    			add_location(p46, file$g, 323, 6, 21724);
    			add_location(div61, file$g, 320, 4, 21468);
    			attr_dev(div62, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div62, file$g, 309, 10, 20707);
    			add_location(center14, file$g, 309, 2, 20699);
    			if (!src_url_equal(img47.src, img47_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134782489727074325/image.png?width=810&height=425")) attr_dev(img47, "src", img47_src_value);
    			set_style(img47, "border-radius", "10px");
    			set_style(img47, "width", "490px");
    			set_style(img47, "height", "320px");
    			add_location(img47, file$g, 329, 4, 21970);
    			attr_dev(p47, "id", "ped-name");
    			set_style(p47, "text-align", "center");
    			attr_dev(p47, "class", "svelte-vym9k4");
    			add_location(p47, file$g, 330, 4, 22157);
    			add_location(div63, file$g, 327, 2, 21906);
    			if (!src_url_equal(img48.src, img48_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134782672988815442/image.png?width=810&height=500")) attr_dev(img48, "src", img48_src_value);
    			set_style(img48, "border-radius", "10px");
    			set_style(img48, "width", "490px");
    			set_style(img48, "height", "320px");
    			add_location(img48, file$g, 334, 4, 22289);
    			attr_dev(p48, "id", "ped-name");
    			set_style(p48, "text-align", "center");
    			attr_dev(p48, "class", "svelte-vym9k4");
    			add_location(p48, file$g, 335, 4, 22476);
    			add_location(div64, file$g, 332, 2, 22227);
    			if (!src_url_equal(img49.src, img49_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134782839305535618/image.png?width=810&height=459")) attr_dev(img49, "src", img49_src_value);
    			set_style(img49, "border-radius", "10px");
    			set_style(img49, "width", "490px");
    			set_style(img49, "height", "320px");
    			add_location(img49, file$g, 339, 4, 22607);
    			attr_dev(p49, "id", "ped-name");
    			set_style(p49, "text-align", "center");
    			attr_dev(p49, "class", "svelte-vym9k4");
    			add_location(p49, file$g, 340, 4, 22795);
    			add_location(div65, file$g, 337, 2, 22545);
    			attr_dev(div66, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div66, file$g, 326, 8, 21805);
    			add_location(center15, file$g, 326, 0, 21797);
    			if (!src_url_equal(img50.src, img50_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134710726632685598/image.png?width=810&height=583")) attr_dev(img50, "src", img50_src_value);
    			set_style(img50, "border-radius", "10px");
    			set_style(img50, "width", "490px");
    			set_style(img50, "height", "320px");
    			add_location(img50, file$g, 346, 4, 23047);
    			attr_dev(p50, "id", "ped-name");
    			set_style(p50, "text-align", "center");
    			attr_dev(p50, "class", "svelte-vym9k4");
    			add_location(p50, file$g, 347, 4, 23234);
    			add_location(div67, file$g, 344, 2, 22983);
    			if (!src_url_equal(img51.src, img51_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134711151960281159/image.png?width=810&height=522")) attr_dev(img51, "src", img51_src_value);
    			set_style(img51, "border-radius", "10px");
    			set_style(img51, "width", "490px");
    			set_style(img51, "height", "320px");
    			add_location(img51, file$g, 351, 4, 23364);
    			attr_dev(p51, "id", "ped-name");
    			set_style(p51, "text-align", "center");
    			attr_dev(p51, "class", "svelte-vym9k4");
    			add_location(p51, file$g, 352, 4, 23551);
    			add_location(div68, file$g, 349, 2, 23302);
    			if (!src_url_equal(img52.src, img52_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134711321808605314/image.png?width=810&height=496")) attr_dev(img52, "src", img52_src_value);
    			set_style(img52, "border-radius", "10px");
    			set_style(img52, "width", "490px");
    			set_style(img52, "height", "320px");
    			add_location(img52, file$g, 356, 4, 23684);
    			attr_dev(p52, "id", "ped-name");
    			set_style(p52, "text-align", "center");
    			attr_dev(p52, "class", "svelte-vym9k4");
    			add_location(p52, file$g, 357, 4, 23872);
    			add_location(div69, file$g, 354, 2, 23622);
    			attr_dev(div70, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div70, file$g, 343, 8, 22882);
    			add_location(center16, file$g, 343, 0, 22874);
    			if (!src_url_equal(img53.src, img53_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134783583853224030/image.png?width=810&height=459")) attr_dev(img53, "src", img53_src_value);
    			set_style(img53, "border-radius", "10px");
    			set_style(img53, "width", "490px");
    			set_style(img53, "height", "320px");
    			add_location(img53, file$g, 363, 4, 24123);
    			attr_dev(p53, "id", "ped-name");
    			set_style(p53, "text-align", "center");
    			attr_dev(p53, "class", "svelte-vym9k4");
    			add_location(p53, file$g, 364, 4, 24310);
    			add_location(div71, file$g, 361, 2, 24059);
    			if (!src_url_equal(img54.src, img54_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134783743228399677/image.png?width=810&height=433")) attr_dev(img54, "src", img54_src_value);
    			set_style(img54, "border-radius", "10px");
    			set_style(img54, "width", "490px");
    			set_style(img54, "height", "320px");
    			add_location(img54, file$g, 368, 4, 24444);
    			attr_dev(p54, "id", "ped-name");
    			set_style(p54, "text-align", "center");
    			attr_dev(p54, "class", "svelte-vym9k4");
    			add_location(p54, file$g, 369, 4, 24631);
    			add_location(div72, file$g, 366, 2, 24382);
    			if (!src_url_equal(img55.src, img55_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134783930017529926/image.png?width=810&height=473")) attr_dev(img55, "src", img55_src_value);
    			set_style(img55, "border-radius", "10px");
    			set_style(img55, "width", "490px");
    			set_style(img55, "height", "320px");
    			add_location(img55, file$g, 373, 4, 24759);
    			attr_dev(p55, "id", "ped-name");
    			set_style(p55, "text-align", "center");
    			attr_dev(p55, "class", "svelte-vym9k4");
    			add_location(p55, file$g, 374, 4, 24947);
    			add_location(div73, file$g, 371, 2, 24697);
    			attr_dev(div74, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div74, file$g, 360, 8, 23958);
    			add_location(center17, file$g, 360, 0, 23950);
    			if (!src_url_equal(img56.src, img56_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134784194938159199/image.png?width=810&height=462")) attr_dev(img56, "src", img56_src_value);
    			set_style(img56, "border-radius", "10px");
    			set_style(img56, "width", "490px");
    			set_style(img56, "height", "320px");
    			add_location(img56, file$g, 380, 4, 25193);
    			attr_dev(p56, "id", "ped-name");
    			set_style(p56, "text-align", "center");
    			attr_dev(p56, "class", "svelte-vym9k4");
    			add_location(p56, file$g, 381, 4, 25380);
    			add_location(div75, file$g, 378, 2, 25129);
    			if (!src_url_equal(img57.src, img57_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134713507556884520/image.png")) attr_dev(img57, "src", img57_src_value);
    			set_style(img57, "border-radius", "10px");
    			set_style(img57, "width", "490px");
    			set_style(img57, "height", "320px");
    			add_location(img57, file$g, 385, 4, 25516);
    			attr_dev(p57, "id", "ped-name");
    			set_style(p57, "text-align", "center");
    			attr_dev(p57, "class", "svelte-vym9k4");
    			add_location(p57, file$g, 386, 4, 25682);
    			add_location(div76, file$g, 383, 2, 25454);
    			if (!src_url_equal(img58.src, img58_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134714228243177553/image.png?width=810&height=480")) attr_dev(img58, "src", img58_src_value);
    			set_style(img58, "border-radius", "10px");
    			set_style(img58, "width", "490px");
    			set_style(img58, "height", "320px");
    			add_location(img58, file$g, 390, 4, 25814);
    			attr_dev(p58, "id", "ped-name");
    			set_style(p58, "text-align", "center");
    			attr_dev(p58, "class", "svelte-vym9k4");
    			add_location(p58, file$g, 391, 4, 26002);
    			add_location(div77, file$g, 388, 2, 25752);
    			attr_dev(div78, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div78, file$g, 377, 8, 25028);
    			add_location(center18, file$g, 377, 0, 25020);
    			if (!src_url_equal(img59.src, img59_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134714527968149564/image.png?width=810&height=545")) attr_dev(img59, "src", img59_src_value);
    			set_style(img59, "border-radius", "10px");
    			set_style(img59, "width", "490px");
    			set_style(img59, "height", "320px");
    			add_location(img59, file$g, 397, 4, 26253);
    			attr_dev(p59, "id", "ped-name");
    			set_style(p59, "text-align", "center");
    			attr_dev(p59, "class", "svelte-vym9k4");
    			add_location(p59, file$g, 398, 4, 26440);
    			add_location(div79, file$g, 395, 2, 26189);
    			if (!src_url_equal(img60.src, img60_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134714688693866616/image.png?width=810&height=515")) attr_dev(img60, "src", img60_src_value);
    			set_style(img60, "border-radius", "10px");
    			set_style(img60, "width", "490px");
    			set_style(img60, "height", "320px");
    			add_location(img60, file$g, 402, 4, 26572);
    			attr_dev(p60, "id", "ped-name");
    			set_style(p60, "text-align", "center");
    			attr_dev(p60, "class", "svelte-vym9k4");
    			add_location(p60, file$g, 403, 4, 26759);
    			add_location(div80, file$g, 400, 2, 26510);
    			if (!src_url_equal(img61.src, img61_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134714915454713944/image.png?width=810&height=456")) attr_dev(img61, "src", img61_src_value);
    			set_style(img61, "border-radius", "10px");
    			set_style(img61, "width", "490px");
    			set_style(img61, "height", "320px");
    			add_location(img61, file$g, 407, 4, 26892);
    			attr_dev(p61, "id", "ped-name");
    			set_style(p61, "text-align", "center");
    			attr_dev(p61, "class", "svelte-vym9k4");
    			add_location(p61, file$g, 408, 4, 27080);
    			add_location(div81, file$g, 405, 2, 26830);
    			attr_dev(div82, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div82, file$g, 394, 8, 26088);
    			add_location(center19, file$g, 394, 0, 26080);
    			if (!src_url_equal(img62.src, img62_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134786484952637470/image.png")) attr_dev(img62, "src", img62_src_value);
    			set_style(img62, "border-radius", "10px");
    			set_style(img62, "width", "490px");
    			set_style(img62, "height", "320px");
    			add_location(img62, file$g, 414, 4, 27327);
    			attr_dev(p62, "id", "ped-name");
    			set_style(p62, "text-align", "center");
    			attr_dev(p62, "class", "svelte-vym9k4");
    			add_location(p62, file$g, 415, 4, 27493);
    			add_location(div83, file$g, 412, 2, 27263);
    			if (!src_url_equal(img63.src, img63_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134786672513536050/image.png")) attr_dev(img63, "src", img63_src_value);
    			set_style(img63, "border-radius", "10px");
    			set_style(img63, "width", "490px");
    			set_style(img63, "height", "320px");
    			add_location(img63, file$g, 419, 4, 27624);
    			attr_dev(p63, "id", "ped-name");
    			set_style(p63, "text-align", "center");
    			attr_dev(p63, "class", "svelte-vym9k4");
    			add_location(p63, file$g, 420, 4, 27790);
    			add_location(div84, file$g, 417, 2, 27562);
    			if (!src_url_equal(img64.src, img64_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134786870652452984/image.png?width=810&height=436")) attr_dev(img64, "src", img64_src_value);
    			set_style(img64, "border-radius", "10px");
    			set_style(img64, "width", "490px");
    			set_style(img64, "height", "320px");
    			add_location(img64, file$g, 424, 4, 27924);
    			attr_dev(p64, "id", "ped-name");
    			set_style(p64, "text-align", "center");
    			attr_dev(p64, "class", "svelte-vym9k4");
    			add_location(p64, file$g, 425, 4, 28112);
    			add_location(div85, file$g, 422, 2, 27862);
    			attr_dev(div86, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div86, file$g, 411, 8, 27162);
    			add_location(center20, file$g, 411, 0, 27154);
    			if (!src_url_equal(img65.src, img65_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134787007760040006/image.png?width=810&height=445")) attr_dev(img65, "src", img65_src_value);
    			set_style(img65, "border-radius", "10px");
    			set_style(img65, "width", "490px");
    			set_style(img65, "height", "320px");
    			add_location(img65, file$g, 431, 4, 28360);
    			attr_dev(p65, "id", "ped-name");
    			set_style(p65, "text-align", "center");
    			attr_dev(p65, "class", "svelte-vym9k4");
    			add_location(p65, file$g, 432, 4, 28547);
    			add_location(div87, file$g, 429, 2, 28296);
    			if (!src_url_equal(img66.src, img66_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134787491308785784/image.png?width=810&height=448")) attr_dev(img66, "src", img66_src_value);
    			set_style(img66, "border-radius", "10px");
    			set_style(img66, "width", "490px");
    			set_style(img66, "height", "320px");
    			add_location(img66, file$g, 436, 4, 28679);
    			attr_dev(p66, "id", "ped-name");
    			set_style(p66, "text-align", "center");
    			attr_dev(p66, "class", "svelte-vym9k4");
    			add_location(p66, file$g, 437, 4, 28866);
    			add_location(div88, file$g, 434, 2, 28617);
    			if (!src_url_equal(img67.src, img67_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134787710196928644/image.png?width=810&height=452")) attr_dev(img67, "src", img67_src_value);
    			set_style(img67, "border-radius", "10px");
    			set_style(img67, "width", "490px");
    			set_style(img67, "height", "320px");
    			add_location(img67, file$g, 441, 4, 29000);
    			attr_dev(p67, "id", "ped-name");
    			set_style(p67, "text-align", "center");
    			attr_dev(p67, "class", "svelte-vym9k4");
    			add_location(p67, file$g, 442, 4, 29188);
    			add_location(div89, file$g, 439, 2, 28938);
    			attr_dev(div90, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div90, file$g, 428, 8, 28195);
    			add_location(center21, file$g, 428, 0, 28187);
    			if (!src_url_equal(img68.src, img68_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134787864371142738/image.png?width=810&height=444")) attr_dev(img68, "src", img68_src_value);
    			set_style(img68, "border-radius", "10px");
    			set_style(img68, "width", "490px");
    			set_style(img68, "height", "320px");
    			add_location(img68, file$g, 448, 4, 29437);
    			attr_dev(p68, "id", "ped-name");
    			set_style(p68, "text-align", "center");
    			attr_dev(p68, "class", "svelte-vym9k4");
    			add_location(p68, file$g, 449, 4, 29624);
    			add_location(div91, file$g, 446, 2, 29373);
    			if (!src_url_equal(img69.src, img69_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134717317109006406/image.png?width=810&height=463")) attr_dev(img69, "src", img69_src_value);
    			set_style(img69, "border-radius", "10px");
    			set_style(img69, "width", "490px");
    			set_style(img69, "height", "320px");
    			add_location(img69, file$g, 453, 4, 29761);
    			attr_dev(p69, "id", "ped-name");
    			set_style(p69, "text-align", "center");
    			attr_dev(p69, "class", "svelte-vym9k4");
    			add_location(p69, file$g, 454, 4, 29948);
    			add_location(div92, file$g, 451, 2, 29699);
    			if (!src_url_equal(img70.src, img70_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134718045064015963/image.png?width=810&height=466")) attr_dev(img70, "src", img70_src_value);
    			set_style(img70, "border-radius", "10px");
    			set_style(img70, "width", "490px");
    			set_style(img70, "height", "320px");
    			add_location(img70, file$g, 458, 4, 30078);
    			attr_dev(p70, "id", "ped-name");
    			set_style(p70, "text-align", "center");
    			attr_dev(p70, "class", "svelte-vym9k4");
    			add_location(p70, file$g, 459, 4, 30266);
    			add_location(div93, file$g, 456, 2, 30016);
    			attr_dev(div94, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div94, file$g, 445, 8, 29272);
    			add_location(center22, file$g, 445, 0, 29264);
    			if (!src_url_equal(img71.src, img71_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134788536952946698/image.png?width=810&height=444")) attr_dev(img71, "src", img71_src_value);
    			set_style(img71, "border-radius", "10px");
    			set_style(img71, "width", "490px");
    			set_style(img71, "height", "320px");
    			add_location(img71, file$g, 465, 4, 30513);
    			attr_dev(p71, "id", "ped-name");
    			set_style(p71, "text-align", "center");
    			attr_dev(p71, "class", "svelte-vym9k4");
    			add_location(p71, file$g, 466, 4, 30700);
    			add_location(div95, file$g, 463, 2, 30449);
    			if (!src_url_equal(img72.src, img72_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134788706516094976/image.png?width=810&height=466")) attr_dev(img72, "src", img72_src_value);
    			set_style(img72, "border-radius", "10px");
    			set_style(img72, "width", "490px");
    			set_style(img72, "height", "320px");
    			add_location(img72, file$g, 470, 4, 30832);
    			attr_dev(p72, "id", "ped-name");
    			set_style(p72, "text-align", "center");
    			attr_dev(p72, "class", "svelte-vym9k4");
    			add_location(p72, file$g, 471, 4, 31019);
    			add_location(div96, file$g, 468, 2, 30770);
    			if (!src_url_equal(img73.src, img73_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134788884660760666/image.png?width=810&height=459")) attr_dev(img73, "src", img73_src_value);
    			set_style(img73, "border-radius", "10px");
    			set_style(img73, "width", "490px");
    			set_style(img73, "height", "320px");
    			add_location(img73, file$g, 475, 4, 31154);
    			attr_dev(p73, "id", "ped-name");
    			set_style(p73, "text-align", "center");
    			attr_dev(p73, "class", "svelte-vym9k4");
    			add_location(p73, file$g, 476, 4, 31342);
    			add_location(div97, file$g, 473, 2, 31092);
    			attr_dev(div98, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div98, file$g, 462, 8, 30348);
    			add_location(center23, file$g, 462, 0, 30340);
    			if (!src_url_equal(img74.src, img74_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134719224921722900/image.png?width=810&height=430")) attr_dev(img74, "src", img74_src_value);
    			set_style(img74, "border-radius", "10px");
    			set_style(img74, "width", "490px");
    			set_style(img74, "height", "320px");
    			add_location(img74, file$g, 482, 4, 31588);
    			attr_dev(p74, "id", "ped-name");
    			set_style(p74, "text-align", "center");
    			attr_dev(p74, "class", "svelte-vym9k4");
    			add_location(p74, file$g, 483, 4, 31775);
    			add_location(div99, file$g, 480, 2, 31524);
    			if (!src_url_equal(img75.src, img75_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134719857385033748/image.png?width=810&height=520")) attr_dev(img75, "src", img75_src_value);
    			set_style(img75, "border-radius", "10px");
    			set_style(img75, "width", "490px");
    			set_style(img75, "height", "320px");
    			add_location(img75, file$g, 487, 4, 31910);
    			attr_dev(p75, "id", "ped-name");
    			set_style(p75, "text-align", "center");
    			attr_dev(p75, "class", "svelte-vym9k4");
    			add_location(p75, file$g, 488, 4, 32097);
    			add_location(div100, file$g, 485, 2, 31848);
    			if (!src_url_equal(img76.src, img76_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134720172423397479/image.png?width=810&height=431")) attr_dev(img76, "src", img76_src_value);
    			set_style(img76, "border-radius", "10px");
    			set_style(img76, "width", "490px");
    			set_style(img76, "height", "320px");
    			add_location(img76, file$g, 492, 4, 32229);
    			attr_dev(p76, "id", "ped-name");
    			set_style(p76, "text-align", "center");
    			attr_dev(p76, "class", "svelte-vym9k4");
    			add_location(p76, file$g, 493, 4, 32417);
    			add_location(div101, file$g, 490, 2, 32167);
    			attr_dev(div102, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div102, file$g, 479, 8, 31423);
    			add_location(center24, file$g, 479, 0, 31415);
    			if (!src_url_equal(img77.src, img77_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134789479375315026/image.png?width=810&height=444")) attr_dev(img77, "src", img77_src_value);
    			set_style(img77, "border-radius", "10px");
    			set_style(img77, "width", "490px");
    			set_style(img77, "height", "320px");
    			add_location(img77, file$g, 499, 4, 32667);
    			attr_dev(p77, "id", "ped-name");
    			set_style(p77, "text-align", "center");
    			attr_dev(p77, "class", "svelte-vym9k4");
    			add_location(p77, file$g, 500, 4, 32854);
    			add_location(div103, file$g, 497, 2, 32603);
    			if (!src_url_equal(img78.src, img78_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134789661588476045/image.png?width=810&height=426")) attr_dev(img78, "src", img78_src_value);
    			set_style(img78, "border-radius", "10px");
    			set_style(img78, "width", "490px");
    			set_style(img78, "height", "320px");
    			add_location(img78, file$g, 504, 4, 32994);
    			attr_dev(p78, "id", "ped-name");
    			set_style(p78, "text-align", "center");
    			attr_dev(p78, "class", "svelte-vym9k4");
    			add_location(p78, file$g, 505, 4, 33181);
    			add_location(div104, file$g, 502, 2, 32932);
    			if (!src_url_equal(img79.src, img79_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134790233246937198/image.png?width=810&height=401")) attr_dev(img79, "src", img79_src_value);
    			set_style(img79, "border-radius", "10px");
    			set_style(img79, "width", "490px");
    			set_style(img79, "height", "320px");
    			add_location(img79, file$g, 509, 4, 33313);
    			attr_dev(p79, "id", "ped-name");
    			set_style(p79, "text-align", "center");
    			attr_dev(p79, "class", "svelte-vym9k4");
    			add_location(p79, file$g, 510, 4, 33501);
    			add_location(div105, file$g, 507, 2, 33251);
    			attr_dev(div106, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div106, file$g, 496, 8, 32502);
    			add_location(center25, file$g, 496, 0, 32494);
    			if (!src_url_equal(img80.src, img80_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134790431893356554/image.png?width=810&height=416")) attr_dev(img80, "src", img80_src_value);
    			set_style(img80, "border-radius", "10px");
    			set_style(img80, "width", "490px");
    			set_style(img80, "height", "320px");
    			add_location(img80, file$g, 516, 4, 33748);
    			attr_dev(p80, "id", "ped-name");
    			set_style(p80, "text-align", "center");
    			attr_dev(p80, "class", "svelte-vym9k4");
    			add_location(p80, file$g, 517, 4, 33935);
    			add_location(div107, file$g, 514, 2, 33684);
    			if (!src_url_equal(img81.src, img81_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134790603079680052/image.png?width=810&height=460")) attr_dev(img81, "src", img81_src_value);
    			set_style(img81, "border-radius", "10px");
    			set_style(img81, "width", "490px");
    			set_style(img81, "height", "320px");
    			add_location(img81, file$g, 521, 4, 34067);
    			attr_dev(p81, "id", "ped-name");
    			set_style(p81, "text-align", "center");
    			attr_dev(p81, "class", "svelte-vym9k4");
    			add_location(p81, file$g, 522, 4, 34254);
    			add_location(div108, file$g, 519, 2, 34005);
    			if (!src_url_equal(img82.src, img82_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134721917115437077/image.png?width=810&height=533")) attr_dev(img82, "src", img82_src_value);
    			set_style(img82, "border-radius", "10px");
    			set_style(img82, "width", "490px");
    			set_style(img82, "height", "320px");
    			add_location(img82, file$g, 526, 4, 34384);
    			attr_dev(p82, "id", "ped-name");
    			set_style(p82, "text-align", "center");
    			attr_dev(p82, "class", "svelte-vym9k4");
    			add_location(p82, file$g, 527, 4, 34572);
    			add_location(div109, file$g, 524, 2, 34322);
    			attr_dev(div110, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div110, file$g, 513, 8, 33583);
    			add_location(center26, file$g, 513, 0, 33575);
    			if (!src_url_equal(img83.src, img83_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134791246372687892/image.png?width=810&height=444")) attr_dev(img83, "src", img83_src_value);
    			set_style(img83, "border-radius", "10px");
    			set_style(img83, "width", "490px");
    			set_style(img83, "height", "320px");
    			add_location(img83, file$g, 533, 4, 34821);
    			attr_dev(p83, "id", "ped-name");
    			set_style(p83, "text-align", "center");
    			attr_dev(p83, "class", "svelte-vym9k4");
    			add_location(p83, file$g, 534, 4, 35008);
    			add_location(div111, file$g, 531, 2, 34757);
    			if (!src_url_equal(img84.src, img84_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134791413666684998/image.png?width=810&height=435")) attr_dev(img84, "src", img84_src_value);
    			set_style(img84, "border-radius", "10px");
    			set_style(img84, "width", "490px");
    			set_style(img84, "height", "320px");
    			add_location(img84, file$g, 538, 4, 35139);
    			attr_dev(p84, "id", "ped-name");
    			set_style(p84, "text-align", "center");
    			attr_dev(p84, "class", "svelte-vym9k4");
    			add_location(p84, file$g, 539, 4, 35326);
    			add_location(div112, file$g, 536, 2, 35077);
    			if (!src_url_equal(img85.src, img85_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134791545854373979/image.png?width=810&height=490")) attr_dev(img85, "src", img85_src_value);
    			set_style(img85, "border-radius", "10px");
    			set_style(img85, "width", "490px");
    			set_style(img85, "height", "320px");
    			add_location(img85, file$g, 543, 4, 35456);
    			attr_dev(p85, "id", "ped-name");
    			set_style(p85, "text-align", "center");
    			attr_dev(p85, "class", "svelte-vym9k4");
    			add_location(p85, file$g, 544, 4, 35644);
    			add_location(div113, file$g, 541, 2, 35394);
    			attr_dev(div114, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div114, file$g, 530, 8, 34656);
    			add_location(center27, file$g, 530, 0, 34648);
    			if (!src_url_equal(img86.src, img86_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134792232399032330/image.png?width=810&height=454")) attr_dev(img86, "src", img86_src_value);
    			set_style(img86, "border-radius", "10px");
    			set_style(img86, "width", "490px");
    			set_style(img86, "height", "320px");
    			add_location(img86, file$g, 550, 4, 35897);
    			attr_dev(p86, "id", "ped-name");
    			set_style(p86, "text-align", "center");
    			attr_dev(p86, "class", "svelte-vym9k4");
    			add_location(p86, file$g, 551, 4, 36084);
    			add_location(div115, file$g, 548, 2, 35833);
    			if (!src_url_equal(img87.src, img87_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134792398002724904/image.png?width=810&height=391")) attr_dev(img87, "src", img87_src_value);
    			set_style(img87, "border-radius", "10px");
    			set_style(img87, "width", "490px");
    			set_style(img87, "height", "320px");
    			add_location(img87, file$g, 555, 4, 36221);
    			attr_dev(p87, "id", "ped-name");
    			set_style(p87, "text-align", "center");
    			attr_dev(p87, "class", "svelte-vym9k4");
    			add_location(p87, file$g, 556, 4, 36408);
    			add_location(div116, file$g, 553, 2, 36159);
    			if (!src_url_equal(img88.src, img88_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134792556157337620/image.png?width=810&height=402")) attr_dev(img88, "src", img88_src_value);
    			set_style(img88, "border-radius", "10px");
    			set_style(img88, "width", "490px");
    			set_style(img88, "height", "320px");
    			add_location(img88, file$g, 560, 4, 36539);
    			attr_dev(p88, "id", "ped-name");
    			set_style(p88, "text-align", "center");
    			attr_dev(p88, "class", "svelte-vym9k4");
    			add_location(p88, file$g, 561, 4, 36727);
    			add_location(div117, file$g, 558, 2, 36477);
    			attr_dev(div118, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div118, file$g, 547, 8, 35732);
    			add_location(center28, file$g, 547, 0, 35724);
    			if (!src_url_equal(img89.src, img89_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134792796490969169/image.png?width=810&height=405")) attr_dev(img89, "src", img89_src_value);
    			set_style(img89, "border-radius", "10px");
    			set_style(img89, "width", "490px");
    			set_style(img89, "height", "320px");
    			add_location(img89, file$g, 567, 4, 36982);
    			attr_dev(p89, "id", "ped-name");
    			set_style(p89, "text-align", "center");
    			attr_dev(p89, "class", "svelte-vym9k4");
    			add_location(p89, file$g, 568, 4, 37169);
    			add_location(div119, file$g, 565, 2, 36918);
    			if (!src_url_equal(img90.src, img90_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134792915160404068/image.png?width=810&height=434")) attr_dev(img90, "src", img90_src_value);
    			set_style(img90, "border-radius", "10px");
    			set_style(img90, "width", "490px");
    			set_style(img90, "height", "320px");
    			add_location(img90, file$g, 572, 4, 37308);
    			attr_dev(p90, "id", "ped-name");
    			set_style(p90, "text-align", "center");
    			attr_dev(p90, "class", "svelte-vym9k4");
    			add_location(p90, file$g, 573, 4, 37495);
    			add_location(div120, file$g, 570, 2, 37246);
    			if (!src_url_equal(img91.src, img91_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134793070668431360/image.png?width=810&height=457")) attr_dev(img91, "src", img91_src_value);
    			set_style(img91, "border-radius", "10px");
    			set_style(img91, "width", "490px");
    			set_style(img91, "height", "320px");
    			add_location(img91, file$g, 577, 4, 37626);
    			attr_dev(p91, "id", "ped-name");
    			set_style(p91, "text-align", "center");
    			attr_dev(p91, "class", "svelte-vym9k4");
    			add_location(p91, file$g, 578, 4, 37814);
    			add_location(div121, file$g, 575, 2, 37564);
    			attr_dev(div122, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div122, file$g, 564, 8, 36817);
    			add_location(center29, file$g, 564, 0, 36809);
    			if (!src_url_equal(img92.src, img92_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134793710081675295/image.png?width=810&height=424")) attr_dev(img92, "src", img92_src_value);
    			set_style(img92, "border-radius", "10px");
    			set_style(img92, "width", "490px");
    			set_style(img92, "height", "320px");
    			add_location(img92, file$g, 584, 4, 38060);
    			attr_dev(p92, "id", "ped-name");
    			set_style(p92, "text-align", "center");
    			attr_dev(p92, "class", "svelte-vym9k4");
    			add_location(p92, file$g, 585, 4, 38247);
    			add_location(div123, file$g, 582, 2, 37996);
    			if (!src_url_equal(img93.src, img93_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134793898108125245/image.png?width=810&height=422")) attr_dev(img93, "src", img93_src_value);
    			set_style(img93, "border-radius", "10px");
    			set_style(img93, "width", "490px");
    			set_style(img93, "height", "320px");
    			add_location(img93, file$g, 589, 4, 38380);
    			attr_dev(p93, "id", "ped-name");
    			set_style(p93, "text-align", "center");
    			attr_dev(p93, "class", "svelte-vym9k4");
    			add_location(p93, file$g, 590, 4, 38567);
    			add_location(div124, file$g, 587, 2, 38318);
    			if (!src_url_equal(img94.src, img94_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134794056921255946/image.png?width=810&height=385")) attr_dev(img94, "src", img94_src_value);
    			set_style(img94, "border-radius", "10px");
    			set_style(img94, "width", "490px");
    			set_style(img94, "height", "320px");
    			add_location(img94, file$g, 594, 4, 38698);
    			attr_dev(p94, "id", "ped-name");
    			set_style(p94, "text-align", "center");
    			attr_dev(p94, "class", "svelte-vym9k4");
    			add_location(p94, file$g, 595, 4, 38886);
    			add_location(div125, file$g, 592, 2, 38636);
    			attr_dev(div126, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div126, file$g, 581, 8, 37895);
    			add_location(center30, file$g, 581, 0, 37887);
    			if (!src_url_equal(img95.src, img95_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134794496303964291/image.png?width=810&height=474")) attr_dev(img95, "src", img95_src_value);
    			set_style(img95, "border-radius", "10px");
    			set_style(img95, "width", "490px");
    			set_style(img95, "height", "320px");
    			add_location(img95, file$g, 601, 4, 39136);
    			attr_dev(p95, "id", "ped-name");
    			set_style(p95, "text-align", "center");
    			attr_dev(p95, "class", "svelte-vym9k4");
    			add_location(p95, file$g, 602, 4, 39323);
    			add_location(div127, file$g, 599, 2, 39072);
    			if (!src_url_equal(img96.src, img96_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134794645742817330/image.png?width=810&height=423")) attr_dev(img96, "src", img96_src_value);
    			set_style(img96, "border-radius", "10px");
    			set_style(img96, "width", "490px");
    			set_style(img96, "height", "320px");
    			add_location(img96, file$g, 606, 4, 39456);
    			attr_dev(p96, "id", "ped-name");
    			set_style(p96, "text-align", "center");
    			attr_dev(p96, "class", "svelte-vym9k4");
    			add_location(p96, file$g, 607, 4, 39643);
    			add_location(div128, file$g, 604, 2, 39394);
    			if (!src_url_equal(img97.src, img97_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134794769483182132/image.png?width=810&height=422")) attr_dev(img97, "src", img97_src_value);
    			set_style(img97, "border-radius", "10px");
    			set_style(img97, "width", "490px");
    			set_style(img97, "height", "320px");
    			add_location(img97, file$g, 611, 4, 39774);
    			attr_dev(p97, "id", "ped-name");
    			set_style(p97, "text-align", "center");
    			attr_dev(p97, "class", "svelte-vym9k4");
    			add_location(p97, file$g, 612, 4, 39962);
    			add_location(div129, file$g, 609, 2, 39712);
    			attr_dev(div130, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div130, file$g, 598, 8, 38971);
    			add_location(center31, file$g, 598, 0, 38963);
    			if (!src_url_equal(img98.src, img98_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134794924634673203/image.png?width=810&height=404")) attr_dev(img98, "src", img98_src_value);
    			set_style(img98, "border-radius", "10px");
    			set_style(img98, "width", "490px");
    			set_style(img98, "height", "320px");
    			add_location(img98, file$g, 618, 4, 40210);
    			attr_dev(p98, "id", "ped-name");
    			set_style(p98, "text-align", "center");
    			attr_dev(p98, "class", "svelte-vym9k4");
    			add_location(p98, file$g, 619, 4, 40397);
    			add_location(div131, file$g, 616, 2, 40146);
    			if (!src_url_equal(img99.src, img99_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134795075356987412/image.png?width=810&height=381")) attr_dev(img99, "src", img99_src_value);
    			set_style(img99, "border-radius", "10px");
    			set_style(img99, "width", "490px");
    			set_style(img99, "height", "320px");
    			add_location(img99, file$g, 623, 4, 40527);
    			attr_dev(p99, "id", "ped-name");
    			set_style(p99, "text-align", "center");
    			attr_dev(p99, "class", "svelte-vym9k4");
    			add_location(p99, file$g, 624, 4, 40714);
    			add_location(div132, file$g, 621, 2, 40465);
    			if (!src_url_equal(img100.src, img100_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134795226733613176/image.png?width=810&height=456")) attr_dev(img100, "src", img100_src_value);
    			set_style(img100, "border-radius", "10px");
    			set_style(img100, "width", "490px");
    			set_style(img100, "height", "320px");
    			add_location(img100, file$g, 628, 4, 40845);
    			attr_dev(p100, "id", "ped-name");
    			set_style(p100, "text-align", "center");
    			attr_dev(p100, "class", "svelte-vym9k4");
    			add_location(p100, file$g, 629, 4, 41033);
    			add_location(div133, file$g, 626, 2, 40783);
    			attr_dev(div134, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div134, file$g, 615, 8, 40045);
    			add_location(center32, file$g, 615, 0, 40037);
    			if (!src_url_equal(img101.src, img101_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134795406996406342/image.png?width=810&height=421")) attr_dev(img101, "src", img101_src_value);
    			set_style(img101, "border-radius", "10px");
    			set_style(img101, "width", "490px");
    			set_style(img101, "height", "320px");
    			add_location(img101, file$g, 635, 4, 41283);
    			attr_dev(p101, "id", "ped-name");
    			set_style(p101, "text-align", "center");
    			attr_dev(p101, "class", "svelte-vym9k4");
    			add_location(p101, file$g, 636, 4, 41470);
    			add_location(div135, file$g, 633, 2, 41219);
    			if (!src_url_equal(img102.src, img102_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134795574571450489/image.png?width=810&height=378")) attr_dev(img102, "src", img102_src_value);
    			set_style(img102, "border-radius", "10px");
    			set_style(img102, "width", "490px");
    			set_style(img102, "height", "320px");
    			add_location(img102, file$g, 640, 4, 41603);
    			attr_dev(p102, "id", "ped-name");
    			set_style(p102, "text-align", "center");
    			attr_dev(p102, "class", "svelte-vym9k4");
    			add_location(p102, file$g, 641, 4, 41790);
    			add_location(div136, file$g, 638, 2, 41541);
    			if (!src_url_equal(img103.src, img103_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134795689667338250/image.png?width=810&height=428")) attr_dev(img103, "src", img103_src_value);
    			set_style(img103, "border-radius", "10px");
    			set_style(img103, "width", "490px");
    			set_style(img103, "height", "320px");
    			add_location(img103, file$g, 645, 4, 41919);
    			attr_dev(p103, "id", "ped-name");
    			set_style(p103, "text-align", "center");
    			attr_dev(p103, "class", "svelte-vym9k4");
    			add_location(p103, file$g, 646, 4, 42107);
    			add_location(div137, file$g, 643, 2, 41857);
    			attr_dev(div138, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div138, file$g, 632, 8, 41118);
    			add_location(center33, file$g, 632, 0, 41110);
    			if (!src_url_equal(img104.src, img104_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134795851764604990/image.png?width=810&height=387")) attr_dev(img104, "src", img104_src_value);
    			set_style(img104, "border-radius", "10px");
    			set_style(img104, "width", "490px");
    			set_style(img104, "height", "320px");
    			add_location(img104, file$g, 652, 4, 42359);
    			attr_dev(p104, "id", "ped-name");
    			set_style(p104, "text-align", "center");
    			attr_dev(p104, "class", "svelte-vym9k4");
    			add_location(p104, file$g, 653, 4, 42546);
    			add_location(div139, file$g, 650, 2, 42295);
    			if (!src_url_equal(img105.src, img105_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134796030328713276/image.png?width=810&height=389")) attr_dev(img105, "src", img105_src_value);
    			set_style(img105, "border-radius", "10px");
    			set_style(img105, "width", "490px");
    			set_style(img105, "height", "320px");
    			add_location(img105, file$g, 657, 4, 42685);
    			attr_dev(p105, "id", "ped-name");
    			set_style(p105, "text-align", "center");
    			attr_dev(p105, "class", "svelte-vym9k4");
    			add_location(p105, file$g, 658, 4, 42872);
    			add_location(div140, file$g, 655, 2, 42623);
    			if (!src_url_equal(img106.src, img106_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134796158070435910/image.png?width=810&height=407")) attr_dev(img106, "src", img106_src_value);
    			set_style(img106, "border-radius", "10px");
    			set_style(img106, "width", "490px");
    			set_style(img106, "height", "320px");
    			add_location(img106, file$g, 662, 4, 43004);
    			attr_dev(p106, "id", "ped-name");
    			set_style(p106, "text-align", "center");
    			attr_dev(p106, "class", "svelte-vym9k4");
    			add_location(p106, file$g, 663, 4, 43192);
    			add_location(div141, file$g, 660, 2, 42942);
    			attr_dev(div142, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div142, file$g, 649, 8, 42194);
    			add_location(center34, file$g, 649, 0, 42186);
    			if (!src_url_equal(img107.src, img107_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134796325901312000/image.png")) attr_dev(img107, "src", img107_src_value);
    			set_style(img107, "border-radius", "10px");
    			set_style(img107, "width", "490px");
    			set_style(img107, "height", "320px");
    			add_location(img107, file$g, 669, 4, 43441);
    			attr_dev(p107, "id", "ped-name");
    			set_style(p107, "text-align", "center");
    			attr_dev(p107, "class", "svelte-vym9k4");
    			add_location(p107, file$g, 670, 4, 43607);
    			add_location(div143, file$g, 667, 2, 43377);
    			if (!src_url_equal(img108.src, img108_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134796443627032586/image.png")) attr_dev(img108, "src", img108_src_value);
    			set_style(img108, "border-radius", "10px");
    			set_style(img108, "width", "490px");
    			set_style(img108, "height", "320px");
    			add_location(img108, file$g, 674, 4, 43739);
    			attr_dev(p108, "id", "ped-name");
    			set_style(p108, "text-align", "center");
    			attr_dev(p108, "class", "svelte-vym9k4");
    			add_location(p108, file$g, 675, 4, 43905);
    			add_location(div144, file$g, 672, 2, 43677);
    			if (!src_url_equal(img109.src, img109_src_value = "https://media.discordapp.net/attachments/1133543254697201754/1134796617942319154/image.png?width=810&height=420")) attr_dev(img109, "src", img109_src_value);
    			set_style(img109, "border-radius", "10px");
    			set_style(img109, "width", "490px");
    			set_style(img109, "height", "320px");
    			add_location(img109, file$g, 679, 4, 44045);
    			attr_dev(p109, "id", "ped-name");
    			set_style(p109, "text-align", "center");
    			attr_dev(p109, "class", "svelte-vym9k4");
    			add_location(p109, file$g, 680, 4, 44233);
    			add_location(div145, file$g, 677, 2, 43983);
    			attr_dev(div146, "style", "display: flex; justify-content : space-around ; flex-wrap: wrap ; margin-top : 10px");
    			add_location(div146, file$g, 666, 8, 43276);
    			add_location(center35, file$g, 666, 0, 43268);
    			set_style(section1, "margin-top", "10px");
    			add_location(section1, file$g, 68, 0, 3792);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$g, 688, 276, 44948);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$g, 688, 327, 44999);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$g, 688, 12, 44684);
    			add_location(button2, file$g, 687, 8, 44637);
    			attr_dev(p110, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p110, file$g, 690, 8, 45153);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$g, 691, 8, 45232);
    			attr_dev(p111, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p111, file$g, 692, 8, 45351);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$g, 693, 8, 45413);
    			attr_dev(div147, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div147, file$g, 686, 4, 44558);
    			attr_dev(section2, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section2, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section2, "z-index", "1000");
    			set_style(section2, "backdrop-filter", "blur(10px)");
    			set_style(section2, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section2, "display", "none");
    			attr_dev(section2, "id", "connect-overlay");
    			add_location(section2, file$g, 685, 0, 44319);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img0);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span0);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, section0, anchor);
    			append_dev(section0, img1);
    			append_dev(section0, t14);
    			append_dev(section0, p0);
    			append_dev(p0, span1);
    			append_dev(p0, t16);
    			append_dev(section0, t17);
    			append_dev(section0, p1);
    			insert_dev(target, t19, anchor);
    			insert_dev(target, section1, anchor);
    			append_dev(section1, center0);
    			append_dev(center0, div6);
    			append_dev(div6, div3);
    			append_dev(div3, img2);
    			append_dev(div3, t20);
    			append_dev(div3, p2);
    			append_dev(div6, t22);
    			append_dev(div6, div4);
    			append_dev(div4, img3);
    			append_dev(div4, t23);
    			append_dev(div4, p3);
    			append_dev(div6, t25);
    			append_dev(div6, div5);
    			append_dev(div5, img4);
    			append_dev(div5, t26);
    			append_dev(div5, p4);
    			append_dev(section1, t28);
    			append_dev(section1, center1);
    			append_dev(center1, div10);
    			append_dev(div10, div7);
    			append_dev(div7, img5);
    			append_dev(div7, t29);
    			append_dev(div7, p5);
    			append_dev(div10, t31);
    			append_dev(div10, div8);
    			append_dev(div8, img6);
    			append_dev(div8, t32);
    			append_dev(div8, p6);
    			append_dev(div10, t34);
    			append_dev(div10, div9);
    			append_dev(div9, img7);
    			append_dev(div9, t35);
    			append_dev(div9, p7);
    			append_dev(section1, t37);
    			append_dev(section1, center2);
    			append_dev(center2, div14);
    			append_dev(div14, div11);
    			append_dev(div11, img8);
    			append_dev(div11, t38);
    			append_dev(div11, p8);
    			append_dev(div14, t40);
    			append_dev(div14, div12);
    			append_dev(div12, img9);
    			append_dev(div12, t41);
    			append_dev(div12, p9);
    			append_dev(div14, t43);
    			append_dev(div14, div13);
    			append_dev(div13, img10);
    			append_dev(div13, t44);
    			append_dev(div13, p10);
    			append_dev(section1, t46);
    			append_dev(section1, center3);
    			append_dev(center3, div18);
    			append_dev(div18, div15);
    			append_dev(div15, img11);
    			append_dev(div15, t47);
    			append_dev(div15, p11);
    			append_dev(div18, t49);
    			append_dev(div18, div16);
    			append_dev(div16, img12);
    			append_dev(div16, t50);
    			append_dev(div16, p12);
    			append_dev(div18, t52);
    			append_dev(div18, div17);
    			append_dev(div17, img13);
    			append_dev(div17, t53);
    			append_dev(div17, p13);
    			append_dev(section1, t55);
    			append_dev(section1, center4);
    			append_dev(center4, div22);
    			append_dev(div22, div19);
    			append_dev(div19, img14);
    			append_dev(div19, t56);
    			append_dev(div19, p14);
    			append_dev(div22, t58);
    			append_dev(div22, div20);
    			append_dev(div20, img15);
    			append_dev(div20, t59);
    			append_dev(div20, p15);
    			append_dev(div22, t61);
    			append_dev(div22, div21);
    			append_dev(div21, img16);
    			append_dev(div21, t62);
    			append_dev(div21, p16);
    			append_dev(section1, t64);
    			append_dev(section1, center5);
    			append_dev(center5, div26);
    			append_dev(div26, div23);
    			append_dev(div23, img17);
    			append_dev(div23, t65);
    			append_dev(div23, p17);
    			append_dev(div26, t67);
    			append_dev(div26, div24);
    			append_dev(div24, img18);
    			append_dev(div24, t68);
    			append_dev(div24, p18);
    			append_dev(div26, t70);
    			append_dev(div26, div25);
    			append_dev(div25, img19);
    			append_dev(div25, t71);
    			append_dev(div25, p19);
    			append_dev(section1, t73);
    			append_dev(section1, center6);
    			append_dev(center6, div30);
    			append_dev(div30, div27);
    			append_dev(div27, img20);
    			append_dev(div27, t74);
    			append_dev(div27, p20);
    			append_dev(div30, t76);
    			append_dev(div30, div28);
    			append_dev(div28, img21);
    			append_dev(div28, t77);
    			append_dev(div28, p21);
    			append_dev(div30, t79);
    			append_dev(div30, div29);
    			append_dev(div29, img22);
    			append_dev(div29, t80);
    			append_dev(div29, p22);
    			append_dev(section1, t82);
    			append_dev(section1, center7);
    			append_dev(center7, div34);
    			append_dev(div34, div31);
    			append_dev(div31, img23);
    			append_dev(div31, t83);
    			append_dev(div31, p23);
    			append_dev(div34, t85);
    			append_dev(div34, div32);
    			append_dev(div32, img24);
    			append_dev(div32, t86);
    			append_dev(div32, p24);
    			append_dev(div34, t88);
    			append_dev(div34, div33);
    			append_dev(div33, img25);
    			append_dev(div33, t89);
    			append_dev(div33, p25);
    			append_dev(section1, t91);
    			append_dev(section1, center8);
    			append_dev(center8, div38);
    			append_dev(div38, div35);
    			append_dev(div35, img26);
    			append_dev(div35, t92);
    			append_dev(div35, p26);
    			append_dev(div38, t94);
    			append_dev(div38, div36);
    			append_dev(div36, img27);
    			append_dev(div36, t95);
    			append_dev(div36, p27);
    			append_dev(div38, t97);
    			append_dev(div38, div37);
    			append_dev(div37, img28);
    			append_dev(div37, t98);
    			append_dev(div37, p28);
    			append_dev(section1, t100);
    			append_dev(section1, center9);
    			append_dev(center9, div42);
    			append_dev(div42, div39);
    			append_dev(div39, img29);
    			append_dev(div39, t101);
    			append_dev(div39, p29);
    			append_dev(div42, t103);
    			append_dev(div42, div40);
    			append_dev(div40, img30);
    			append_dev(div40, t104);
    			append_dev(div40, p30);
    			append_dev(div42, t106);
    			append_dev(div42, div41);
    			append_dev(div41, img31);
    			append_dev(div41, t107);
    			append_dev(div41, p31);
    			append_dev(section1, t109);
    			append_dev(section1, center10);
    			append_dev(center10, div46);
    			append_dev(div46, div43);
    			append_dev(div43, img32);
    			append_dev(div43, t110);
    			append_dev(div43, p32);
    			append_dev(div46, t112);
    			append_dev(div46, div44);
    			append_dev(div44, img33);
    			append_dev(div44, t113);
    			append_dev(div44, p33);
    			append_dev(div46, t115);
    			append_dev(div46, div45);
    			append_dev(div45, img34);
    			append_dev(div45, t116);
    			append_dev(div45, p34);
    			append_dev(section1, t118);
    			append_dev(section1, center11);
    			append_dev(center11, div50);
    			append_dev(div50, div47);
    			append_dev(div47, img35);
    			append_dev(div47, t119);
    			append_dev(div47, p35);
    			append_dev(div50, t121);
    			append_dev(div50, div48);
    			append_dev(div48, img36);
    			append_dev(div48, t122);
    			append_dev(div48, p36);
    			append_dev(div50, t124);
    			append_dev(div50, div49);
    			append_dev(div49, img37);
    			append_dev(div49, t125);
    			append_dev(div49, p37);
    			append_dev(section1, t127);
    			append_dev(section1, center12);
    			append_dev(center12, div54);
    			append_dev(div54, div51);
    			append_dev(div51, img38);
    			append_dev(div51, t128);
    			append_dev(div51, p38);
    			append_dev(div54, t130);
    			append_dev(div54, div52);
    			append_dev(div52, img39);
    			append_dev(div52, t131);
    			append_dev(div52, p39);
    			append_dev(div54, t133);
    			append_dev(div54, div53);
    			append_dev(div53, img40);
    			append_dev(div53, t134);
    			append_dev(div53, p40);
    			append_dev(section1, t136);
    			append_dev(section1, center13);
    			append_dev(center13, div58);
    			append_dev(div58, div55);
    			append_dev(div55, img41);
    			append_dev(div55, t137);
    			append_dev(div55, p41);
    			append_dev(div58, t139);
    			append_dev(div58, div56);
    			append_dev(div56, img42);
    			append_dev(div56, t140);
    			append_dev(div56, p42);
    			append_dev(div58, t142);
    			append_dev(div58, div57);
    			append_dev(div57, img43);
    			append_dev(div57, t143);
    			append_dev(div57, p43);
    			append_dev(section1, t145);
    			append_dev(section1, center14);
    			append_dev(center14, div62);
    			append_dev(div62, div59);
    			append_dev(div59, img44);
    			append_dev(div59, t146);
    			append_dev(div59, p44);
    			append_dev(div62, t148);
    			append_dev(div62, div60);
    			append_dev(div60, img45);
    			append_dev(div60, t149);
    			append_dev(div60, p45);
    			append_dev(div62, t151);
    			append_dev(div62, div61);
    			append_dev(div61, img46);
    			append_dev(div61, t152);
    			append_dev(div61, p46);
    			append_dev(section1, t154);
    			append_dev(section1, center15);
    			append_dev(center15, div66);
    			append_dev(div66, div63);
    			append_dev(div63, img47);
    			append_dev(div63, t155);
    			append_dev(div63, p47);
    			append_dev(div66, t157);
    			append_dev(div66, div64);
    			append_dev(div64, img48);
    			append_dev(div64, t158);
    			append_dev(div64, p48);
    			append_dev(div66, t160);
    			append_dev(div66, div65);
    			append_dev(div65, img49);
    			append_dev(div65, t161);
    			append_dev(div65, p49);
    			append_dev(section1, t163);
    			append_dev(section1, center16);
    			append_dev(center16, div70);
    			append_dev(div70, div67);
    			append_dev(div67, img50);
    			append_dev(div67, t164);
    			append_dev(div67, p50);
    			append_dev(div70, t166);
    			append_dev(div70, div68);
    			append_dev(div68, img51);
    			append_dev(div68, t167);
    			append_dev(div68, p51);
    			append_dev(div70, t169);
    			append_dev(div70, div69);
    			append_dev(div69, img52);
    			append_dev(div69, t170);
    			append_dev(div69, p52);
    			append_dev(section1, t172);
    			append_dev(section1, center17);
    			append_dev(center17, div74);
    			append_dev(div74, div71);
    			append_dev(div71, img53);
    			append_dev(div71, t173);
    			append_dev(div71, p53);
    			append_dev(div74, t175);
    			append_dev(div74, div72);
    			append_dev(div72, img54);
    			append_dev(div72, t176);
    			append_dev(div72, p54);
    			append_dev(div74, t178);
    			append_dev(div74, div73);
    			append_dev(div73, img55);
    			append_dev(div73, t179);
    			append_dev(div73, p55);
    			append_dev(section1, t181);
    			append_dev(section1, center18);
    			append_dev(center18, div78);
    			append_dev(div78, div75);
    			append_dev(div75, img56);
    			append_dev(div75, t182);
    			append_dev(div75, p56);
    			append_dev(div78, t184);
    			append_dev(div78, div76);
    			append_dev(div76, img57);
    			append_dev(div76, t185);
    			append_dev(div76, p57);
    			append_dev(div78, t187);
    			append_dev(div78, div77);
    			append_dev(div77, img58);
    			append_dev(div77, t188);
    			append_dev(div77, p58);
    			append_dev(section1, t190);
    			append_dev(section1, center19);
    			append_dev(center19, div82);
    			append_dev(div82, div79);
    			append_dev(div79, img59);
    			append_dev(div79, t191);
    			append_dev(div79, p59);
    			append_dev(div82, t193);
    			append_dev(div82, div80);
    			append_dev(div80, img60);
    			append_dev(div80, t194);
    			append_dev(div80, p60);
    			append_dev(div82, t196);
    			append_dev(div82, div81);
    			append_dev(div81, img61);
    			append_dev(div81, t197);
    			append_dev(div81, p61);
    			append_dev(section1, t199);
    			append_dev(section1, center20);
    			append_dev(center20, div86);
    			append_dev(div86, div83);
    			append_dev(div83, img62);
    			append_dev(div83, t200);
    			append_dev(div83, p62);
    			append_dev(div86, t202);
    			append_dev(div86, div84);
    			append_dev(div84, img63);
    			append_dev(div84, t203);
    			append_dev(div84, p63);
    			append_dev(div86, t205);
    			append_dev(div86, div85);
    			append_dev(div85, img64);
    			append_dev(div85, t206);
    			append_dev(div85, p64);
    			append_dev(section1, t208);
    			append_dev(section1, center21);
    			append_dev(center21, div90);
    			append_dev(div90, div87);
    			append_dev(div87, img65);
    			append_dev(div87, t209);
    			append_dev(div87, p65);
    			append_dev(div90, t211);
    			append_dev(div90, div88);
    			append_dev(div88, img66);
    			append_dev(div88, t212);
    			append_dev(div88, p66);
    			append_dev(div90, t214);
    			append_dev(div90, div89);
    			append_dev(div89, img67);
    			append_dev(div89, t215);
    			append_dev(div89, p67);
    			append_dev(section1, t217);
    			append_dev(section1, center22);
    			append_dev(center22, div94);
    			append_dev(div94, div91);
    			append_dev(div91, img68);
    			append_dev(div91, t218);
    			append_dev(div91, p68);
    			append_dev(div94, t220);
    			append_dev(div94, div92);
    			append_dev(div92, img69);
    			append_dev(div92, t221);
    			append_dev(div92, p69);
    			append_dev(div94, t223);
    			append_dev(div94, div93);
    			append_dev(div93, img70);
    			append_dev(div93, t224);
    			append_dev(div93, p70);
    			append_dev(section1, t226);
    			append_dev(section1, center23);
    			append_dev(center23, div98);
    			append_dev(div98, div95);
    			append_dev(div95, img71);
    			append_dev(div95, t227);
    			append_dev(div95, p71);
    			append_dev(div98, t229);
    			append_dev(div98, div96);
    			append_dev(div96, img72);
    			append_dev(div96, t230);
    			append_dev(div96, p72);
    			append_dev(div98, t232);
    			append_dev(div98, div97);
    			append_dev(div97, img73);
    			append_dev(div97, t233);
    			append_dev(div97, p73);
    			append_dev(section1, t235);
    			append_dev(section1, center24);
    			append_dev(center24, div102);
    			append_dev(div102, div99);
    			append_dev(div99, img74);
    			append_dev(div99, t236);
    			append_dev(div99, p74);
    			append_dev(div102, t238);
    			append_dev(div102, div100);
    			append_dev(div100, img75);
    			append_dev(div100, t239);
    			append_dev(div100, p75);
    			append_dev(div102, t241);
    			append_dev(div102, div101);
    			append_dev(div101, img76);
    			append_dev(div101, t242);
    			append_dev(div101, p76);
    			append_dev(section1, t244);
    			append_dev(section1, center25);
    			append_dev(center25, div106);
    			append_dev(div106, div103);
    			append_dev(div103, img77);
    			append_dev(div103, t245);
    			append_dev(div103, p77);
    			append_dev(div106, t247);
    			append_dev(div106, div104);
    			append_dev(div104, img78);
    			append_dev(div104, t248);
    			append_dev(div104, p78);
    			append_dev(div106, t250);
    			append_dev(div106, div105);
    			append_dev(div105, img79);
    			append_dev(div105, t251);
    			append_dev(div105, p79);
    			append_dev(section1, t253);
    			append_dev(section1, center26);
    			append_dev(center26, div110);
    			append_dev(div110, div107);
    			append_dev(div107, img80);
    			append_dev(div107, t254);
    			append_dev(div107, p80);
    			append_dev(div110, t256);
    			append_dev(div110, div108);
    			append_dev(div108, img81);
    			append_dev(div108, t257);
    			append_dev(div108, p81);
    			append_dev(div110, t259);
    			append_dev(div110, div109);
    			append_dev(div109, img82);
    			append_dev(div109, t260);
    			append_dev(div109, p82);
    			append_dev(section1, t262);
    			append_dev(section1, center27);
    			append_dev(center27, div114);
    			append_dev(div114, div111);
    			append_dev(div111, img83);
    			append_dev(div111, t263);
    			append_dev(div111, p83);
    			append_dev(div114, t265);
    			append_dev(div114, div112);
    			append_dev(div112, img84);
    			append_dev(div112, t266);
    			append_dev(div112, p84);
    			append_dev(div114, t268);
    			append_dev(div114, div113);
    			append_dev(div113, img85);
    			append_dev(div113, t269);
    			append_dev(div113, p85);
    			append_dev(section1, t271);
    			append_dev(section1, center28);
    			append_dev(center28, div118);
    			append_dev(div118, div115);
    			append_dev(div115, img86);
    			append_dev(div115, t272);
    			append_dev(div115, p86);
    			append_dev(div118, t274);
    			append_dev(div118, div116);
    			append_dev(div116, img87);
    			append_dev(div116, t275);
    			append_dev(div116, p87);
    			append_dev(div118, t277);
    			append_dev(div118, div117);
    			append_dev(div117, img88);
    			append_dev(div117, t278);
    			append_dev(div117, p88);
    			append_dev(section1, t280);
    			append_dev(section1, center29);
    			append_dev(center29, div122);
    			append_dev(div122, div119);
    			append_dev(div119, img89);
    			append_dev(div119, t281);
    			append_dev(div119, p89);
    			append_dev(div122, t283);
    			append_dev(div122, div120);
    			append_dev(div120, img90);
    			append_dev(div120, t284);
    			append_dev(div120, p90);
    			append_dev(div122, t286);
    			append_dev(div122, div121);
    			append_dev(div121, img91);
    			append_dev(div121, t287);
    			append_dev(div121, p91);
    			append_dev(section1, t289);
    			append_dev(section1, center30);
    			append_dev(center30, div126);
    			append_dev(div126, div123);
    			append_dev(div123, img92);
    			append_dev(div123, t290);
    			append_dev(div123, p92);
    			append_dev(div126, t292);
    			append_dev(div126, div124);
    			append_dev(div124, img93);
    			append_dev(div124, t293);
    			append_dev(div124, p93);
    			append_dev(div126, t295);
    			append_dev(div126, div125);
    			append_dev(div125, img94);
    			append_dev(div125, t296);
    			append_dev(div125, p94);
    			append_dev(section1, t298);
    			append_dev(section1, center31);
    			append_dev(center31, div130);
    			append_dev(div130, div127);
    			append_dev(div127, img95);
    			append_dev(div127, t299);
    			append_dev(div127, p95);
    			append_dev(div130, t301);
    			append_dev(div130, div128);
    			append_dev(div128, img96);
    			append_dev(div128, t302);
    			append_dev(div128, p96);
    			append_dev(div130, t304);
    			append_dev(div130, div129);
    			append_dev(div129, img97);
    			append_dev(div129, t305);
    			append_dev(div129, p97);
    			append_dev(section1, t307);
    			append_dev(section1, center32);
    			append_dev(center32, div134);
    			append_dev(div134, div131);
    			append_dev(div131, img98);
    			append_dev(div131, t308);
    			append_dev(div131, p98);
    			append_dev(div134, t310);
    			append_dev(div134, div132);
    			append_dev(div132, img99);
    			append_dev(div132, t311);
    			append_dev(div132, p99);
    			append_dev(div134, t313);
    			append_dev(div134, div133);
    			append_dev(div133, img100);
    			append_dev(div133, t314);
    			append_dev(div133, p100);
    			append_dev(section1, t316);
    			append_dev(section1, center33);
    			append_dev(center33, div138);
    			append_dev(div138, div135);
    			append_dev(div135, img101);
    			append_dev(div135, t317);
    			append_dev(div135, p101);
    			append_dev(div138, t319);
    			append_dev(div138, div136);
    			append_dev(div136, img102);
    			append_dev(div136, t320);
    			append_dev(div136, p102);
    			append_dev(div138, t322);
    			append_dev(div138, div137);
    			append_dev(div137, img103);
    			append_dev(div137, t323);
    			append_dev(div137, p103);
    			append_dev(section1, t325);
    			append_dev(section1, center34);
    			append_dev(center34, div142);
    			append_dev(div142, div139);
    			append_dev(div139, img104);
    			append_dev(div139, t326);
    			append_dev(div139, p104);
    			append_dev(div142, t328);
    			append_dev(div142, div140);
    			append_dev(div140, img105);
    			append_dev(div140, t329);
    			append_dev(div140, p105);
    			append_dev(div142, t331);
    			append_dev(div142, div141);
    			append_dev(div141, img106);
    			append_dev(div141, t332);
    			append_dev(div141, p106);
    			append_dev(section1, t334);
    			append_dev(section1, center35);
    			append_dev(center35, div146);
    			append_dev(div146, div143);
    			append_dev(div143, img107);
    			append_dev(div143, t335);
    			append_dev(div143, p107);
    			append_dev(div146, t337);
    			append_dev(div146, div144);
    			append_dev(div144, img108);
    			append_dev(div144, t338);
    			append_dev(div144, p108);
    			append_dev(div146, t340);
    			append_dev(div146, div145);
    			append_dev(div145, img109);
    			append_dev(div145, t341);
    			append_dev(div145, p109);
    			insert_dev(target, t343, anchor);
    			insert_dev(target, section2, anchor);
    			append_dev(section2, div147);
    			append_dev(div147, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div147, t344);
    			append_dev(div147, p110);
    			append_dev(div147, t346);
    			append_dev(div147, input);
    			append_dev(div147, t347);
    			append_dev(div147, p111);
    			append_dev(div147, t349);
    			append_dev(div147, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$e, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$e, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(section0);
    			if (detaching) detach_dev(t19);
    			if (detaching) detach_dev(section1);
    			if (detaching) detach_dev(t343);
    			if (detaching) detach_dev(section2);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$h.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$e() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$e() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$h($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Vehicles', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Vehicles> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$e, close_overlay: close_overlay$e });
    	return [];
    }

    class Vehicles extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$h, create_fragment$h, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Vehicles",
    			options,
    			id: create_fragment$h.name
    		});
    	}
    }

    /* src\routes\Companies.svelte generated by Svelte v3.59.2 */

    const file$h = "src\\routes\\Companies.svelte";

    function create_fragment$i(ctx) {
    	let nav;
    	let div2;
    	let a0;
    	let img0;
    	let img0_src_value;
    	let t0;
    	let div0;
    	let button0;
    	let t2;
    	let button1;
    	let span0;
    	let t4;
    	let svg0;
    	let path0;
    	let t5;
    	let div1;
    	let ul;
    	let li0;
    	let a1;
    	let t7;
    	let li1;
    	let a2;
    	let t9;
    	let li2;
    	let a3;
    	let t11;
    	let li3;
    	let a4;
    	let t13;
    	let section0;
    	let img1;
    	let img1_src_value;
    	let t14;
    	let p0;
    	let span1;
    	let t16;
    	let p1;
    	let t18;
    	let iframe;
    	let iframe_src_value;
    	let t19;
    	let section1;
    	let div3;
    	let button2;
    	let svg1;
    	let path1;
    	let path2;
    	let t20;
    	let p2;
    	let t22;
    	let input;
    	let t23;
    	let p3;
    	let t25;
    	let a5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			nav = element("nav");
    			div2 = element("div");
    			a0 = element("a");
    			img0 = element("img");
    			t0 = space();
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play Now";
    			t2 = space();
    			button1 = element("button");
    			span0 = element("span");
    			span0.textContent = "Open main menu";
    			t4 = space();
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			t5 = space();
    			div1 = element("div");
    			ul = element("ul");
    			li0 = element("li");
    			a1 = element("a");
    			a1.textContent = "Home";
    			t7 = space();
    			li1 = element("li");
    			a2 = element("a");
    			a2.textContent = "Robberies Guide";
    			t9 = space();
    			li2 = element("li");
    			a3 = element("a");
    			a3.textContent = "Mini Game";
    			t11 = space();
    			li3 = element("li");
    			a4 = element("a");
    			a4.textContent = "Discord";
    			t13 = space();
    			section0 = element("section");
    			img1 = element("img");
    			t14 = space();
    			p0 = element("p");
    			span1 = element("span");
    			span1.textContent = "Companies";
    			t16 = space();
    			p1 = element("p");
    			p1.textContent = "Welcome to \"Barbaros,\" the vibrant and diverse world of our FiveM server, where a myriad of companies await your exploration. \r\n      Immerse yourself in the mechanical mastery of the \"Mecano Company,\" fixing and modifying vehicles to your heart's desire. \r\n      Satisfy your cravings at \"Pizza\" and \"Burgershot,\" where delicious treats await the hungry. \r\n      Unwind and embrace the spirit of Mexico at \"Tequila\" and experience the pulsating nightlife at \"Wuchang Bar.\" \r\n      For an exquisite taste of Japan, visit the \"Sushi Restaurant,\" and if you crave the Irish charm, there's the cozy \"Irish Pub Coffee.\" \r\n      Gear up with the latest rides from the \"Car Dealer\" and the \"Motor Dealer,\" and if you're feeling edgy, explore the unique collection \r\n      at the \"White Widow Shop.\" Embrace limitless possibilities as you venture through the bustling world of \r\n      \"Barbaros,\" where fun, adventure, and endless surprises await!";
    			t18 = space();
    			iframe = element("iframe");
    			t19 = space();
    			section1 = element("section");
    			div3 = element("div");
    			button2 = element("button");
    			svg1 = svg_element("svg");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			t20 = space();
    			p2 = element("p");
    			p2.textContent = "Connect Via IP:";
    			t22 = space();
    			input = element("input");
    			t23 = space();
    			p3 = element("p");
    			p3.textContent = "OR";
    			t25 = space();
    			a5 = element("a");
    			a5.textContent = "OPEN FIVEM";
    			if (!src_url_equal(img0.src, img0_src_value = "/assets/img/logo-text-flag.webp")) attr_dev(img0, "src", img0_src_value);
    			attr_dev(img0, "class", "h-14 mr-3 mt-1");
    			attr_dev(img0, "alt", "Barbaros Logo");
    			add_location(img0, file$h, 15, 6, 560);
    			attr_dev(a0, "href", "/");
    			attr_dev(a0, "class", "flex items-center");
    			add_location(a0, file$h, 14, 4, 514);
    			attr_dev(button0, "type", "button");
    			attr_dev(button0, "class", "text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-6 py-2 text-center mr-3 md:mr-0 duration-200 mt-1");
    			add_location(button0, file$h, 18, 6, 701);
    			attr_dev(span0, "class", "sr-only");
    			add_location(span0, file$h, 20, 6, 1305);
    			attr_dev(path0, "stroke", "currentColor");
    			attr_dev(path0, "stroke-linecap", "round");
    			attr_dev(path0, "stroke-linejoin", "round");
    			attr_dev(path0, "stroke-width", "2");
    			attr_dev(path0, "d", "M1 1h15M1 7h15M1 13h15");
    			add_location(path0, file$h, 22, 8, 1473);
    			attr_dev(svg0, "class", "w-5 h-5");
    			attr_dev(svg0, "aria-hidden", "true");
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "fill", "none");
    			attr_dev(svg0, "viewBox", "0 0 17 14");
    			add_location(svg0, file$h, 21, 6, 1356);
    			attr_dev(button1, "data-collapse-toggle", "navbar-cta");
    			attr_dev(button1, "type", "button");
    			attr_dev(button1, "class", "inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600");
    			attr_dev(button1, "aria-controls", "navbar-cta");
    			attr_dev(button1, "aria-expanded", "false");
    			add_location(button1, file$h, 19, 6, 950);
    			attr_dev(div0, "class", "flex md:order-2");
    			add_location(div0, file$h, 17, 4, 664);
    			attr_dev(a1, "href", "/");
    			attr_dev(a1, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a1, file$h, 30, 6, 1926);
    			add_location(li0, file$h, 28, 6, 1861);
    			attr_dev(a2, "href", "/#/robguide");
    			attr_dev(a2, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a2, file$h, 33, 6, 2027);
    			add_location(li1, file$h, 32, 6, 2015);
    			attr_dev(a3, "href", "/#/mini");
    			attr_dev(a3, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a3, file$h, 36, 10, 2157);
    			add_location(li2, file$h, 35, 8, 2141);
    			attr_dev(a4, "href", "https://discord.gg/barbaros");
    			attr_dev(a4, "class", "block py-2 pl-3 pr-4 text-white text-lg");
    			add_location(a4, file$h, 39, 6, 2271);
    			add_location(li3, file$h, 38, 6, 2259);
    			attr_dev(ul, "class", "flex flex-col font-medium p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 md:mt-0 md:border-0");
    			add_location(ul, file$h, 27, 4, 1747);
    			attr_dev(div1, "class", "items-center justify-between hidden w-full md:flex md:w-auto md:order-1");
    			attr_dev(div1, "id", "navbar-cta");
    			add_location(div1, file$h, 26, 4, 1640);
    			attr_dev(div2, "class", "max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4");
    			add_location(div2, file$h, 13, 4, 423);
    			attr_dev(nav, "class", "bg-[url('/assets/img/hero-bg.webp')] bg-cover bg-no-repeat");
    			add_location(nav, file$h, 12, 2, 345);
    			if (!src_url_equal(img1.src, img1_src_value = "/assets/img/left-fly-community.png")) attr_dev(img1, "src", img1_src_value);
    			attr_dev(img1, "alt", "Object");
    			attr_dev(img1, "class", "absolute right-0");
    			add_location(img1, file$h, 46, 4, 2494);
    			attr_dev(span1, "class", "text-[#7C5BF1]");
    			add_location(span1, file$h, 47, 49, 2629);
    			attr_dev(p0, "class", "text-5xl font-bold text-[#2F344F]");
    			add_location(p0, file$h, 47, 4, 2584);
    			attr_dev(p1, "class", "text-lg mt-4 text-[#2F344F] text-center w-2/4");
    			add_location(p1, file$h, 48, 4, 2684);
    			attr_dev(section0, "class", "flex flex-col items-center relative mt-8");
    			add_location(section0, file$h, 45, 2, 2430);
    			if (!src_url_equal(iframe.src, iframe_src_value = "/page/companies.html")) attr_dev(iframe, "src", iframe_src_value);
    			attr_dev(iframe, "title", "W3Schools Free Online Web Tutorials");
    			attr_dev(iframe, "class", "w-full");
    			attr_dev(iframe, "scrolling", "no");
    			attr_dev(iframe, "onload", "resizeIframe(this)");
    			add_location(iframe, file$h, 59, 2, 3712);
    			attr_dev(path1, "d", "M0 0h24v24H0z");
    			set_style(path1, "fill", "none");
    			add_location(path1, file$h, 63, 268, 4471);
    			attr_dev(path2, "d", "M18 6 6 18M6 6l12 12");
    			set_style(path2, "fill", "none");
    			set_style(path2, "fill-rule", "nonzero");
    			set_style(path2, "stroke", "rgb(0, 0, 0)");
    			set_style(path2, "stroke-width", "2px");
    			add_location(path2, file$h, 63, 319, 4522);
    			attr_dev(svg1, "class", "h-8 fixed top-5 right-10");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "xml:space", "preserve");
    			attr_dev(svg1, "fill", "#000000");
    			set_style(svg1, "fill-rule", "evenodd");
    			set_style(svg1, "clip-rule", "evenodd");
    			set_style(svg1, "stroke-linecap", "round");
    			set_style(svg1, "stroke-linejoin", "round");
    			set_style(svg1, "stroke-miterlimit", "2");
    			set_style(svg1, "filter", "invert(1)");
    			add_location(svg1, file$h, 63, 4, 4207);
    			add_location(button2, file$h, 62, 2, 4168);
    			attr_dev(p2, "class", "font-semibold text-white text-2xl mb-2");
    			add_location(p2, file$h, 65, 2, 4664);
    			input.value = "connect brrp.online";
    			attr_dev(input, "class", "py-2 px-4 rounded text-lg bg-gray-100 focus:outline-none");
    			input.readOnly = true;
    			add_location(input, file$h, 66, 2, 4737);
    			attr_dev(p3, "class", "text-white my-2 font-bold text-2xl");
    			add_location(p3, file$h, 67, 2, 4850);
    			attr_dev(a5, "href", "fivem://connect/brrp.online");
    			attr_dev(a5, "class", "text-xl text-black bg-white border-2 border-transparent hover:text-white hover:border-white hover:bg-transparent font-medium px-16 py-2 text-center duration-200 mt-1 rounded");
    			add_location(a5, file$h, 68, 2, 4906);
    			attr_dev(div3, "class", "flex flex-col justify-center items-center w-full h-full");
    			add_location(div3, file$h, 61, 0, 4095);
    			attr_dev(section1, "class", "fixed top-0 left-0 w-screen h-screen overflow-hidden");
    			set_style(section1, "background-color", "rgba(0, 0, 0, 0.9)");
    			set_style(section1, "z-index", "1000");
    			set_style(section1, "backdrop-filter", "blur(10px)");
    			set_style(section1, "-webkit-backdrop-filter", "blur(10px)");
    			set_style(section1, "display", "none");
    			attr_dev(section1, "id", "connect-overlay");
    			add_location(section1, file$h, 60, 0, 3860);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, nav, anchor);
    			append_dev(nav, div2);
    			append_dev(div2, a0);
    			append_dev(a0, img0);
    			append_dev(div2, t0);
    			append_dev(div2, div0);
    			append_dev(div0, button0);
    			append_dev(div0, t2);
    			append_dev(div0, button1);
    			append_dev(button1, span0);
    			append_dev(button1, t4);
    			append_dev(button1, svg0);
    			append_dev(svg0, path0);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, ul);
    			append_dev(ul, li0);
    			append_dev(li0, a1);
    			append_dev(ul, t7);
    			append_dev(ul, li1);
    			append_dev(li1, a2);
    			append_dev(ul, t9);
    			append_dev(ul, li2);
    			append_dev(li2, a3);
    			append_dev(ul, t11);
    			append_dev(ul, li3);
    			append_dev(li3, a4);
    			insert_dev(target, t13, anchor);
    			insert_dev(target, section0, anchor);
    			append_dev(section0, img1);
    			append_dev(section0, t14);
    			append_dev(section0, p0);
    			append_dev(p0, span1);
    			append_dev(section0, t16);
    			append_dev(section0, p1);
    			insert_dev(target, t18, anchor);
    			insert_dev(target, iframe, anchor);
    			insert_dev(target, t19, anchor);
    			insert_dev(target, section1, anchor);
    			append_dev(section1, div3);
    			append_dev(div3, button2);
    			append_dev(button2, svg1);
    			append_dev(svg1, path1);
    			append_dev(svg1, path2);
    			append_dev(div3, t20);
    			append_dev(div3, p2);
    			append_dev(div3, t22);
    			append_dev(div3, input);
    			append_dev(div3, t23);
    			append_dev(div3, p3);
    			append_dev(div3, t25);
    			append_dev(div3, a5);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", open_overlay$f, false, false, false, false),
    					listen_dev(button2, "click", close_overlay$f, false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(nav);
    			if (detaching) detach_dev(t13);
    			if (detaching) detach_dev(section0);
    			if (detaching) detach_dev(t18);
    			if (detaching) detach_dev(iframe);
    			if (detaching) detach_dev(t19);
    			if (detaching) detach_dev(section1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$i.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function open_overlay$f() {
    	document.getElementById("connect-overlay").style.display = "block";
    	document.body.style = "overflow: hidden;";
    }

    function close_overlay$f() {
    	document.getElementById("connect-overlay").style.display = "none";
    	document.body.style = "overflow: auto;";
    }

    function instance$i($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Companies', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Companies> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ open_overlay: open_overlay$f, close_overlay: close_overlay$f });
    	return [];
    }

    class Companies extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$i, create_fragment$i, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Companies",
    			options,
    			id: create_fragment$i.name
    		});
    	}
    }

    var routes = {
        '/': Home,
        '/rules': Rules,
        '/m': Mobile,
        '/p' : Police ,
        '/illegal' : Illegal , 
        '/gangwar' : Gangwar , 
        '/robguide' : Robguide, 
        '/business' : Business,
        '/crime' : Crime,
        '/discord' : Discord ,
        '/ems' : Ems ,
        '/safe' : Safe ,
        '/mortrp' : Mortrp ,
        '/mini': Minigame,
        '/peds': Peds , 
        '/car' : Vehicles ,
        '/companies' : Companies,
            // The catch-all route must always be last
        '*': NotFound
    };

    /* src\App.svelte generated by Svelte v3.59.2 */
    const file$i = "src\\App.svelte";

    function create_fragment$j(ctx) {
    	let main;
    	let router;
    	let current;
    	router = new Router({ props: { routes }, $$inline: true });

    	const block = {
    		c: function create() {
    			main = element("main");
    			create_component(router.$$.fragment);
    			attr_dev(main, "class", "dark scroll-smooth");
    			add_location(main, file$i, 7, 0, 170);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			mount_component(router, main, null);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(router.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(router.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_component(router);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$j.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$j($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	document.addEventListener('contextmenu', event => event.preventDefault());
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Router, routes });
    	return [];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$j, create_fragment$j, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$j.name
    		});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
