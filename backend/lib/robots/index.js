const dreame = require("./dreame");
const karcher = require("./karcher");
const midea = require("./midea");
const mock = require("./mock");
const roborock = require("./roborock");
const viomi = require("./viomi");

module.exports = Object.assign({},
    roborock,
    viomi,
    dreame,
    karcher,
    midea,
    mock
);
