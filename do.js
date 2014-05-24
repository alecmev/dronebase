function write(text) {
    WScript.StdOut.Write(text);
}

function writeLine(text) {
    WScript.StdOut.WriteLine(text);
}

function writeLines(lines) {
    WScript.StdOut.WriteLine(lines.join('\n'));
}

function writeDebug(text) {
    if (typeof text == 'undefined') {
        text = 'debug';
    }

    WScript.StdOut.WriteLine(text);
}

function usage() {
    writeLines([
        'Usage: do [command]',
        '',
        'Commands:',
        '  deploy  Push the project to the server'
    ]);
}

function unknownArgument(arg) {
    writeLines([
        'Unknown argument: ' + arg,
        ''
    ]);
    usage();
    WScript.Quit(0);
}

// try {
var shell = new ActiveXObject('WScript.Shell');
var fs = new ActiveXObject('Scripting.FileSystemObject');
shell.CurrentDirectory = fs.GetParentFolderName(WScript.ScriptFullName);

var args = WScript.Arguments;
if (!args.length) {
    usage();
    WScript.Quit(0);
}

switch (args(0)) {
case 'deploy': {
    write('Deploying... ');
    var res = 0;
    res += shell.Run('git push server master', 0, true);
    if (!res) {
        // res += shell.Run(
        //     'ssh root@jeremejevs.com "' +
        //         'cd /root/jeremejevs.git && ' +
        //         'git reset --hard && ' +
        //         '/root/jeremejevs.sh' +
        //     '"', 0, true
        // );
    }

    if (res) {
        writeLine('fail');
    }
    else {
        writeLine('done');
    }

    break;
}
default: {
    unknownArgument(args(0));
}
}
// }
// catch (e) {
//     if (typeof e == 'object') {
//         e = e.message;
//     }

//     writeLine(red(e));
// }
