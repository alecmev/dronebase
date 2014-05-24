// // var ect = require('ect');
// // var express = require('express');
// var crypto = require("crypto")
//   , net = require('net')
//   , sock = new net.Socket()
//   , nextseq = 0
//   , callbacks = {}
//   , tmpbuf = new Buffer(0)
//   , tmpsequence
//   , tmpsize = false
//   , tmpnumwords
//   , maskseq = 0x3FFFFFFF;

// // var app = express();
// // var renderer = ect({
// //     root: __dirname + '/views',
// //     ext: '.html',
// //     watch: true,
// //     open: '{{',
// //     close: '}}'
// // });

// // app.engine('html', renderer.render);
// // app.set('view engine', 'html');

// // app.get('/', function(req, res) {


// //     res.render('test', { title: 'Epic title', test: 'Blahity blah' });
// // });

// // app.listen(80);



// // command should be either a string or an array of words
// function request(command, callback) {
//     var words
//       , i
//       , invalid = false
//       , size = 12
//       , data
//       , offset = 12;
//     if (nextseq > maskseq) {
//         nextseq = 0;
//     }

//     if (command instanceof Array) {
//         words = command;
//         for (i = 0; i < words.length; ++i) {
//             if (typeof words[i] != 'string') {
//                 invalid = true;
//                 break;
//             }

//             words[i] = words[i].match(/([^\s]+)/g);
//             if (!words[i].length || words[i].length > 1) {
//                 invalid = true;
//                 break;
//             }

//             words[i] = words[i][0];
//             size += words[i].length + 5;
//         }
//     }
//     else if (typeof command == 'string') {
//         words = command.match(/([^\s]+)/g);
//         words.forEach(function(word) {
//             size += word.length + 5;
//         });
//     }
//     else {
//         invalid = true;
//     }

//     if (!words.length) {
//         invalid = true;
//     }

//     if (invalid) {
//         console.error('ERROR: invalid argument "command"');
//         return;
//     }

//     console.log('request  [' + nextseq + ']: ' + words.join(' '));
//     data = new Buffer(size);
//     callbacks[nextseq] = typeof callback == 'function' ? callback : false;
//     data.writeUInt32LE(nextseq++, 0);
//     data.writeUInt32LE(size, 4);
//     data.writeUInt32LE(words.length, 8);
//     words.forEach(function(word) {
//         data.writeUInt32LE(word.length, offset);
//         data.write(word, offset + 4);
//         offset += word.length + 5;
//         data[offset - 1] = 0;
//     });

//     sock.write(data);
// }

// sock.on('data', function(data) {
//     var i
//       , wordlen
//       , offset = 12
//       , response = [];
//     tmpbuf = Buffer.concat([tmpbuf, data]);
//     if (tmpbuf.length < 12) {
//         return;
//     }

//     if (!tmpsize) {
//         tmpsequence = tmpbuf.readUInt32LE(0) & 0x3FFFFFFF;
//         tmpsize = tmpbuf.readUInt32LE(4);
//         tmpnumwords = tmpbuf.readUInt32LE(8);
//     }

//     if (tmpbuf.length < tmpsize) {
//         return;
//     }

//     for (i = 0; i < tmpnumwords; ++i) {
//         wordlen = tmpbuf.readUInt32LE(offset);
//         response.push(tmpbuf.toString('utf8', offset + 4, offset + 4 + wordlen));
//         offset += wordlen + 5;
//     }

//     tmpbuf = tmpbuf.slice(offset);
//     tmpsize = false;
//     console.log('response [' + tmpsequence + ']: ' + response.join(' '));
//     callbacks[tmpsequence] && callbacks[tmpsequence](response);
// });

// sock.connect(47210, '46.253.198.84', function() {
//     console.log('connected');
//     request('login.hashed', function(response) {
//         var hash = crypto.createHash('md5');
//         hash.setEncoding('hex');
//         hash.write(response[1], 'hex');
//         hash.write('fatal1ty', 'utf8');
//         hash.end();
//         request('login.hashed ' + hash.read().toUpperCase(), function(response) {
//             request(['admin.eventsEnabled', 'true']);
//         });
//     });
// });

// // 91.198.152.35:25505
// // 041A613B
