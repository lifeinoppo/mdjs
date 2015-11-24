/**
 * @file mdjs
 * @author xiaowu
 * @email fe.xiaowu@gmail.com
 */

'use strict';

import extend from 'extend';
import template from 'art-template/node/template-native';

import express from 'express';
import serve_static from 'serve-static';

import fs from 'fs';
import url from 'url';
import path from 'path';

import Key_cache from 'key-cache';

import marked from 'marked';
import highlight from 'highlight.js';

export default class {
    options = {
        name: 'mdjs',
        port: 8091,
        root: './',
        cache_path: './.cache/',
        dir_alias: {},
        static_prefix: 'static',
        ignore_dir: [
            '.svn',
            '.git',
            'node_modules'
        ],
        links: [
        ]
    }

    /**
     * 构造器
     *
     * @param  {Object} options 配置参数
     */
    constructor(options = {}) {
        let package_options;
        try {
            package_options = require(path.resolve('./package.json')).mdjs || {};
        }
        catch (e) {
            package_options = {};
        }

        // 合并默认配置
        // 合并的顺序是： 参数 > package.mdjs > 默认 （由左向右合并）
        options = this.options = extend({}, this.options, package_options, options);

        options.root = path.resolve('./', options.root);
        options.cache_path = path.resolve('./', options.cache_path);

        // 缓存当前运行的目录
        this.__dirname = path.dirname(__dirname);

        this.run();
    }

    /**
     * 获取渲染后的导航数据
     *
     * @param  {string|undefined} uri 当前高亮的路径，如果为空则全不高亮， 高亮即展开
     *
     * @return {string}     html代码
     */
    get_render_nav(uri) {
        let data = this.get_list();
        let str = '';

        if (!data || !data.length) {
            return str;
        }

        uri = decodeURIComponent(uri);

        let filter = (filepath) => {
            if (!uri) {
                return false;
            }

            if (uri.indexOf(filepath) === 0) {
                return true;
            }
            return false;
        };

        let fn = (res) => {
            let html = '';

            res.forEach((val) => {
                if (!val.children || !val.children.length) {
                    if (filter(val.uri)) {
                        html += `<li class="nav-tree-file nav-tree-current">`;
                    }
                    else {
                        html += `<li class="nav-tree-file">`;
                    }
                    html += `
                            <div class="nav-tree-text">
                                <a href="${val.uri}" class="nav-tree-file-a" data-uri="${val.uri}" title="${val.text}">
                                    ${val.text}
                                </a>
                            </div>
                        </li>
                    `;
                }
                else {
                    if (filter(val.uri)) {
                        html += `<li class="nav-tree-dir nav-tree-dir-open">`;
                    }
                    else {
                        html += `<li class="nav-tree-dir">`;
                    }
                    html += `
                            <div class="nav-tree-text">
                                <a href="#" class="nav-tree-dir-a" data-uri="${val.uri}" title="${val.text}">
                                    ${val.text}
                                </a>
                            </div>
                            ${fn(val.children)}
                        </li>
                    `;
                }
            });

            return '<ul>' + html + '</ul>';
        };

        return fn(data);
    }

    /**
     * 清空缓存
     *
     * @return {Object} this
     */
    clear_cache() {
        let cache = new Key_cache({
            dir: this.options.cache_path
        });

        cache.remove();

        return this;
    }

    /**
     * 获取navtree使用数据，会追加options.links
     *
     * @return {Array} 数组
     */
    get_list() {
        // 优化读取缓存
        let cache = new Key_cache({
            dir: this.options.cache_path
        });
        let nav_data = cache.get('nav_data');

        // 如果缓存存在
        if (nav_data) {
            return nav_data;
        }

        let data = this._get_list();

        if (!data.children) {
            data.children = [];
        }

        // 如果有链接，则追加
        if (this.options.links && this.options.links.length) {
            this.options.links.forEach(val => {
                if (val.type === 'after') {
                    data.children.push(val);
                }
                else {
                    data.children.unshift(val);
                }
            });
        }

        nav_data = data.children;

        // 写入缓存
        cache.set('nav_data', nav_data);
        return nav_data;
    }

    /**
     * 渲染md文件
     *
     * @param  {string} content md源码
     *
     * @return {Object}         {content:html代码, catalog: h2,3分类}
     */
    renderMarkdown(content = '') {
        let renderer = new marked.Renderer();
        let cachekey = {};

        let catalog = [];

        // 渲染标题
        renderer.heading = (text, level) => {
            let key;

            if (level !== 2 && level !== 3) {
                return `<h${level}>${text}</h${level}>`;
            }

            if (!cachekey[level]) {
                cachekey[level] = 0;
            }

            key = ++cachekey[level];

            catalog.push({
                text: text,
                level: level,
                id: `h${level}-${key}`
            });

            return `
                <h${level}>
                    <span>
                        <a name="h${level}-${key}" class="anchor" href="#h${level}-${key}"></a>
                        <span>${text}</span>
                    </span>
                </h${level}>
            `;
        };


        // 渲染代码
        renderer.code = (data, lang) => {
            data = highlight.highlightAuto(data).value;

            // 必须有语言且行数>=2
            if (lang && data.split(/\n/).length >= 3) {
                return `
                    <pre>
                        <code class="hljs lang-${lang}"><span class="hljs-lang-tips">${lang}</span>${data}</code>
                    </pre>`;
            }

            return `<pre><code class="hljs">${data}</code></pre>`;
        };

        // md => html
        content = marked(content, {
            renderer: renderer
        });

        // 兼容todo
        content = content.replace(/<li>\s*\[ \]\s*/g, '<li><input type="checkbox" class="ui-todo" disabled>');
        content = content.replace(/<li>\s*\[x\]\s*/g, '<li><input type="checkbox" disabled checked class="ui-todo">');

        return {
            content: content,
            catalog: catalog
        };
    }

    /**
     * 运行
     */
    run() {
        let app = this.express = express();

        app.get('/test', (req, res, next) => {
            let data = this.get_list();

            res.json(data);
        });

        template.config('base', '');
        template.config('extname', '.html');

        app.engine('.html', template.__express);
        app.set('views', path.resolve(this.__dirname, './views/'));
        app.set('view engine', 'html');

        // 解析md，解决中文路径问题
        app.use((req, res, next) => {
            // 写入变量
            res.locals.options = this.options;

            return next();
        });

        // 绑定.md文档
        app.get(/([\s\S]+?)\.md$/, this._md.bind(this));

        // 监听以目录结束的，其实是为了解决默认主页为md文档问题
        app.get(/(^\/$|\/$)/, (req, res, next) => {
            let pathname = url.parse(req.url).pathname.substr(1);

            let default_index = [
                'readme.md',
                'README.md'
            ];
            let flag = false;
            for (let i = 0, len = default_index.length; i < len; i++) {
                if (fs.existsSync(path.resolve(this.options.root, pathname, default_index[i]))) {
                    flag = default_index[i];
                    break;
                }
            }

            if (flag) {
                req.url += flag;
                return this._md(req, res, next);
            }

            next();
        });

        // 委托静态资源
        app.use('/' + this.options.static_prefix, serve_static(path.resolve(this.__dirname, './static/')));

        // 委托源目录
        app.use('/', serve_static(this.options.root));

        app.listen(this.options.port);
    }

    /**
     * 内部获取列表数据
     *
     * @private
     * @param  {string|undefined} dir 目录
     *
     * @return {Object}     {path:'', children:[]}
     */
    _get_list(dir) {
        let options = this.options;
        let result;

        dir = dir || options.root;

        let basename = path.basename(dir);

        result = {
            uri: dir.replace(options.root, '') || '/',
            children: [],
            text: options.dir_alias[basename] || basename
        };

        let data = fs.readdirSync(dir);

        data.forEach(file => {
            let filepath = path.resolve(dir, file);
            let stat = fs.statSync(filepath);

            if (stat.isDirectory()) {
                if (options.ignore_dir && options.ignore_dir.indexOf(file) !== -1) {
                    return;
                }

                let res = this._get_list(filepath);

                if (res.children && res.children.length) {
                    result.children.push(res);
                }
            }
            else if (stat.isFile()) {
                if (path.extname(file) !== '.md') {
                    return;
                }

                result.children.push({
                    text: this._get_md_title(dir + '/' + file),
                    uri: (dir + '/' + file).replace(options.root, '')
                });
            }
        });

        return result;
    }

    /**
     * 渲染md文档
     *
     * @private
     * @param  {Object}   req  express.req
     * @param  {Object}   res  express.res
     * @param  {Function} next 下一个路由
     * @return {Object} res
     */
    _md(req, res, next) {
        let parseUrl = url.parse(req.url, true);

        // 如果要读取源码
        if (parseUrl.query.source) {
            return next();
        }

        let filepath = decodeURIComponent(parseUrl.pathname.substr(1));

        filepath = path.resolve(this.options.root, filepath);

        // 如果md文件不存在
        if (!fs.existsSync(filepath)) {
            return next();
        }

        let htmldata = this.renderMarkdown(fs.readFileSync(filepath).toString()).content;

        // 如果是pjax
        if (parseUrl.query.pjax) {
            return res.end(htmldata);
        }

        // 渲染md
        return res.render('markdown', {
            nav_data: this.get_render_nav(parseUrl.pathname),
            markdown_data: htmldata,
            title: `${this._get_md_title(filepath)} - ${this.options.name}`
        });
    }

    /**
     * 内部获取md文档的标题
     *
     * @private
     * @param  {string} filepath 文件路径
     *
     * @return {string}     标题
     */
    _get_md_title(filepath) {
        // 如果是md扩展
        if (path.extname(filepath) === '.md') {
            // 获取文件内容
            let filedata = fs.readFileSync(filepath).toString();

            // 正则取出#标题的文字
            if (filedata.match(/^\#+\s?(.+?)[\r\n]/)) {
                return String(RegExp.$1).trim();
            }
        }

        return path.basename(filepath);
    }
}
