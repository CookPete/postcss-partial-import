var assign  = require('object-assign');
var path    = require('path');
var postcss = require('postcss');

var makeCSS = require('./lib/makeCSS');
var getPath = require('./lib/getPath');
var readCSS = require('./lib/readCSS');
var readNPM = require('./lib/readNPM');

module.exports = postcss.plugin('postcss-partial-import', function (opts) {
	// Options with defaults
	opts = assign({
		dirs:      [],
		encoding:  'utf8',
		extension: '.css',
		generate:  false,
		plugins:   [],
		prefix:    '_',
		addDependencyTo: false
	}, opts);

	if (!Array.isArray(opts.dirs)) {
		// Normalized dirs array
		opts.dirs = [opts.dirs];
	}

	// Extended dirs array
	opts.dirs.push(process.cwd(), 'node_modules', 'bower_components');

	if (!Array.isArray(opts.plugins)) {
		// Normalized plugins array
		opts.plugins = [opts.plugins];
	}

	// Prepared processor
	var processor = postcss(opts.plugins);

	// Promise transformed CSS
	var transformPromise = function (css) {
		// Empty imports collection
		var imports = [];

		// For each `import` at-rule
		css.walkAtRules('import', function (atRule) {
			// Whether the addDependency option is configured
			var hasAddDependencyMethod = opts.addDependencyTo && typeof opts.addDependencyTo.addDependency === 'function';

			if (hasAddDependencyMethod) {
				opts.addDependencyTo.addDependency(atRule.source.input.file);
			}

			// Directory of the current link
			var dir = path.dirname(atRule.source.input.file);

			// At-rule params
			var params = postcss.list.space(atRule.params);

			// Matching expressions
			var matchWithinURL    = /^url\((.*?)\)$/;
			var matchWithinQuote  = /^(['"])(.*?)\1$/;
			var matchStartingHTTP = /^(https?:)?\/\//;

			// Reference link; e.g. `another-file.css` in `@import another-file.css`;
			var link = (params[0] || '').replace(matchWithinURL, '$1').replace(matchWithinQuote, '$2');

			if (link) {
				// Media query; e.g. `screen` in `@import another-file.css screen`
				var media = params.slice(1).join(' ');

				// Whether source is not HTTP (which is ignored)
				var isNotHTTP = !matchStartingHTTP.test(link);

				if (isNotHTTP) {
					// Promise the at-rule replaced with the AST of its link
					var importPromise = transformImport(atRule, link, media, dir);

					// Push the promise into the imports array
					imports.push(importPromise);
				}
			}
		});

		// Promise every at-rule is processed
		var importsPromise = Promise.all(imports);

		return importsPromise;
	};

	var transformImport = function (atRule, link, media, dir) {
		// Promise to read a local CSS file (placeholder)
		var localPromise = Promise.reject();

		// For each possible directory (starting with the current)
		[dir].concat(opts.dirs).forEach(function (localdir) {
			// File relative to the local directory
			var localfile = getPath(path.resolve(localdir, link), opts.prefix, opts.extension);

			// Promise the local CSS file is processed
			localPromise = localPromise.catch(function () {
				return readCSS(localfile, opts.encoding, processor);
			});
		});

		// Promise the NPM package is processed
		var npmPromise = localPromise.catch(function () {
			return readNPM(link, opts.encoding, processor);
		});

		// Promise the local file is created
		var generateLocalPromise = npmPromise.catch(function () {
			if (opts.generate) {
				// File relative to the local directory
				var localfile = getPath(path.resolve(dir, link), opts.prefix, opts.extension);

				return makeCSS(localfile, processor);
			}
		});

		// Promise the AST replaces the import
		var replacePromise = generateLocalPromise.then(function (ast) {
			if (ast) {
				return transformPromise(ast.root).then(function () {
					if (media) {
						// Replace the at-rule with a media query
						atRule.name = 'media';
						atRule.params = media;

						atRule.raws.between = ' ';

						// Append the AST to the media query
						atRule.append(ast.root);
					} else {
						// Replace the at-rule with the AST
						atRule.replaceWith(ast.root);
					}
				});
			}
		});

		return replacePromise;
	};

	return transformPromise;
});
