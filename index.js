var fs = require("fs");
var path = require("path");
var marked = require("marked");
var vash = require("vash");
var shell = require('shelljs');

marked.setOptions({
    gfm: true,
    headerIds: true,
    langPrefix: "hljs language-",
    tables: true,
    sanitize: false // Do not sanitize as we want the ability to diplay raw html tags in markdown
});

// https://stackoverflow.com/a/497790
var dates = {
    convert:function(d) {
        // Converts the date in d to a date-object. The input can be:
        //   a date object: returned without modification
        //  an array      : Interpreted as [year,month,day]. NOTE: month is 0-11.
        //   a number     : Interpreted as number of milliseconds
        //                  since 1 Jan 1970 (a timestamp)
        //   a string     : Any format supported by the javascript engine, like
        //                  "YYYY/MM/DD", "MM/DD/YYYY", "Jan 31 2009" etc.
        //  an object     : Interpreted as an object with year, month and date
        //                  attributes.  **NOTE** month is 0-11.
        return (
            d.constructor === Date ? d :
                d.constructor === Array ? new Date(d[0],d[1],d[2]) :
                    d.constructor === Number ? new Date(d) :
                        d.constructor === String ? new Date(d) :
                            typeof d === "object" ? new Date(d.year,d.month,d.date) :
                                NaN
        );
    },
    compare: function(a,b) {
        // Compare two dates (could be of any type supported by the convert
        // function above) and returns:
        //  -1 : if a < b
        //   0 : if a = b
        //   1 : if a > b
        // NaN : if a or b is an illegal date
        // NOTE: The code inside isFinite does an assignment (=).
        return (
            isFinite(a=this.convert(a).valueOf()) &&
            isFinite(b=this.convert(b).valueOf()) ?
                (a>b)-(a<b) :
                NaN
        );
    }
};

var templatesPath = path.join(__dirname, "templates");
var articlesPath = path.join(__dirname, "articles");

// Load template
var indexTemplate = vash.compile(fs.readFileSync(path.join(templatesPath, "index.html"), "utf-8"));
var articleTemplate = vash.compile(fs.readFileSync(path.join(templatesPath, "article.html"), "utf-8"));
var files = {};
var articles = [];
var articlesWithHidden = [];

readFiles(articlesPath, function (filename, content) {
    files[filename.toString()] = content.toString();
});

Object.keys(files).forEach(function(fileName) {
    var fileContent = files[fileName];
    var end = fileContent.indexOf("---", 5);

    var keyValues = fileContent.substring(3, end);
    var keyValuesSplitted = keyValues.split("\n");
    var model = {};

    keyValuesSplitted.forEach(function (pair) {
        if (pair.length === 0)
            return;

        var splitted = pair.split(": ");
        var key = splitted[0];

        // Fix up legacy stuff
        if (key === "authorUrl")
            key = "author_url";

        model[key] = splitted[1];
    });

    var renderedMarkdown = marked(fileContent.substr(end + 3));
    var title = encodeURIComponent(fileName.substring(0, fileName.length - 3));
    var date = new Date(Date.parse(convertToISODate(model["date"])));
    var url = "/" + date.getFullYear() + "/" + (date.getMonth() + 1) + "/" + title;

    var a = renderedMarkdown.substring(0, renderedMarkdown.indexOf('<h2'));

    model["__raw__title"] = title;
    model["url"] = url;
    model["article"] = renderedMarkdown;
    model["preview"] = a;

    articlesWithHidden.push(model);

    if (model["hidden"] === undefined || model["hidden"] === null || model["hidden"] !== "true")
        articles.push(model);
});

articles = articles.sort(function (a, b) {
    var dateA = new Date(Date.parse(convertToISODate(a["date"])));
    var dateB = new Date(Date.parse(convertToISODate(b["date"])));

    return dates.compare(dateB, dateA);
});

// RENDER INDEX WITH ALL ARTICLES

var renderedIndex = indexTemplate(articles);
fs.writeFileSync("_site/index.html", renderedIndex);

// END INDEX WITH ALL ARTICLES
// START FOR EACH ARTICLE GENERATE A PAGE

articlesWithHidden.forEach(function (model) {
    var date = new Date(Date.parse(convertToISODate(model["date"])));
    var path = "_site/" + date.getFullYear() + "/" + (date.getMonth() + 1);

    shell.mkdir('-p', path);

    var renderedIndex = articleTemplate(model);

    path += "/" + model["__raw__title"] + ".html";
    fs.writeFileSync(path, renderedIndex);
});


// END FOR EACH ARTICLE GENERATE A PAGE

// https://stackoverflow.com/a/10049704
function readFiles(dirname, onFileContent) {
    fs.readdirSync(dirname).forEach(function(filename) {
        onFileContent(filename, fs.readFileSync(path.join(articlesPath, filename)));
    });
}

// Quick and dirty hack because JavaScript date parsing is not very nice
function convertToISODate(glacierStr) {
    var mapping = {
        january: "01",
        february: "02",
        march: "03",
        april: "04",
        may: "05",
        june: "06",
        july: "07",
        august: "08",
        september: "09",
        october: "10",
        november: "11",
        december: "12"
    };

    // October 21, 2018
    var splitted = glacierStr.split(" ");
    var month = splitted[0];
    var day = splitted[1];
    day = day.substring(0, day.length - 1);
    var year = splitted[2];

    // 2018-10-21T00:00:00
    return year + "-" + mapping[month.toLowerCase()] + "-" + day;
}

// https://stackoverflow.com/a/1137579
String.prototype.replaceAll = function(search, replace) {
    //if replace is not sent, return original string otherwise it will
    //replace search string with 'undefined'.
    if (replace === undefined) {
        return this.toString();
    }

    return this.replace(new RegExp('[' + search + ']', 'g'), replace);
};

