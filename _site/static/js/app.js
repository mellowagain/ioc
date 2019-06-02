hljs.initHighlightingOnLoad();

var quotes = document.getElementsByTagName("blockquote");
var codes = document.getElementsByTagName("code");

for (var i = 0; i < quotes.length; i++) {
    var quote = quotes[i];
    quote.innerHTML = quote.innerHTML.trim();
}

for (var j = 0; j < codes.length; j++) {
    var code = codes[j];
    code.innerHTML = code.innerHTML.trim();
}
