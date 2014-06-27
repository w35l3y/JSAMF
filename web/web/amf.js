/*
amf.js - An AMF library in JavaScript

Copyright (c) 2010, James Ward - www.jamesward.com
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY JAMES WARD ''AS IS'' AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JAMES WARD OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The views and conclusions contained in the software and documentation are those of the
authors and should not be interpreted as representing official policies, either expressed
or implied, of James Ward.
*/

// fallback swf bridge for IE (js file still encodes the data)
var swfBridgeLocation = "js/bridge.swf",
swfBridgeRemotingProxyList = [],
_window = this;

function decodeAMF (data)
{
  var bytes = new amf.ByteArray(data, amf.Endian.BIG, amf.ObjectEncoding.AMF0),
  version = bytes.readUnsignedShort();
  //bytes.objectEncoding = version; // what is the point of keeping AMF0 ?
  //console.log(dumpHex(bytes));

  var response = new amf.AMFPacket(version);
  // Headers
  var headerCount = bytes.readUnsignedShort();
  for (var h = 0; h < headerCount; h++) {
    var headerName = bytes.readUTF(),
    mustUnderstand = bytes.readBoolean();
    bytes.readInt(); // Consume header length...

    // Handle AVM+ type marker
    if (version == amf.ObjectEncoding.AMF3) {
      var typeMarker = bytes.readByte();
      if (typeMarker == amf.Amf0Types.kAvmPlusObjectType) {
        bytes.objectEncoding = amf.ObjectEncoding.AMF3;
      } else {
        --bytes.pos;
      }
    }

    var headerValue = bytes.readObject();
  
    var header = new amf.AMFHeader(headerName, mustUnderstand, headerValue);
    response.headers.push(header);

    // Reset to AMF0 for next header
    bytes.objectEncoding = amf.ObjectEncoding.AMF0;
  }
  // Message Bodies
  var messageCount = bytes.readUnsignedShort();
  for (var m = 0; m < messageCount; m++) {
    var targetURI = bytes.readUTF(),
    responseURI = bytes.readUTF();
    bytes.readInt(); // Consume message body length...

    // Handle AVM+ type marker
    if (version == amf.ObjectEncoding.AMF3)
    {
      var typeMarker = bytes.readByte();
      if (typeMarker == amf.Amf0Types.kAvmPlusObjectType) {
        bytes.objectEncoding = amf.ObjectEncoding.AMF3;
      } else {
        --bytes.pos;
      }
    }
    var messageBody = bytes.readObject();

    var message = new amf.AMFMessage(targetURI, responseURI, messageBody);
    response.messages.push(message);
    
    bytes.objectEncoding = amf.ObjectEncoding.AMF0;
  }

  return response;
}

function encodeAMF(obj) {
    if (!obj.headers) {
      obj.headers = [];
    }
    if (!obj.messages) {
        obj.messages = [];
    }

    // begin to write the request for data
    var e = amf.Endian.BIG,
    v = (obj.version?obj.version:amf.ObjectEncoding.AMF0),
    bytes = new amf.ByteArray([], e, v);

    bytes.writeInt(bytes.objectEncoding, 16);// protocol version 0 or 3.

    bytes.writeInt(obj.headers.length, 16);// headers count
    for each (var h in obj.headers) {
      // @TODO test headers
      bytes.writeUTF(h.name); //header name
      bytes.writeInt(0, 8);// must understand

      var header = new amf.ByteArray([], e, v);
      //header.writeInt(1, 8); // type of header (????)
      //header.writeInt(amf.Amf0Types.kAvmPlusObjectType, 8);// AMF3 (headers too?)
      header.writeObject(h.data);

      bytes.writeInt(header.data.length, 32);//  header data length (-1 for unknown)
      Array.prototype.push.apply(bytes.data, header.data);
    }

    bytes.writeInt(obj.messages.length, 16);// messages count
    for each (var m in obj.messages) {
      bytes.writeUTF(m.targetURL);//  target
      bytes.writeUTF(m.responseURI);//  response

      var body = new amf.ByteArray([], e, v);
      //body.writeInt(amf.Amf0Types.kAvmPlusObjectType, 8);// AMF3
      body.writeObject(m.body);

      bytes.writeInt(body.data.length, 32);//  message data length (-1 for unknown)
      Array.prototype.push.apply(bytes.data, body.data);
    }

    return String.fromCharCode.apply(null, bytes.data);
}

function ErrorClass() {
  
}

// remoting proxy type
function RemotingProxy(url, service, encoding)
{
  this.url = url;
  this.service = service;
  this.encoding = encoding;
  this.handles = [];
  this.response_number = 0;

  // vars used if you're using the swf gateway
  this.flashgateway;
  this.flashgatewayloaded;
  this.flashgatewaybuffer = [];

  // either AMF 0 or 3.
  if (encoding != amf.ObjectEncoding.AMF0 &&
    encoding != amf.ObjectEncoding.AMF3) {
    this.encoding = amf.ObjectEncoding.AMF0;
  }

  // if you're on IE, we need to add the flash file to send the binary data.
  if('undefined' != typeof(_window.ActiveXObject)) {
    var bridge = '<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000" \
       id="ExternalFlashInterface" width="400" height="400"\
       codebase="http://download.macromedia.com/pub/shockwave/cabs/flash/swflash.cab">\
     <param name="movie" value="'+swfBridgeLocation+'" />\
     <param name="allowScriptAccess" value="sameDomain" />\
     <embed src="'+swfBridgeLocation+'"\
       width="400" height="400" name="ExternalFlashInterface" align="middle"\
       play="true" loop="false" quality="high" allowScriptAccess="sameDomain"\
       type="application/x-shockwave-flash"\
       pluginspage="http://www.macromedia.com/go/getflashplayer">\
     </embed>\
    </object>';
    document.body.innerHTML += bridge;

    if (navigator.appName.indexOf("Microsoft") != -1) {
      this.flashgateway = _window["ExternalFlashInterface"];
    } else {
      this.flashgateway = document["ExternalFlashInterface"];
    }
    this.flashgatewayloaded = false;
    swfBridgeRemotingProxyList.push (this);
  }
  registerClassAlias("flex.messaging.messages.ErrorMessage", ErrorClass);
}

// object that gets created upon a remote request
RemotingProxy.RequestHandle = function (req, resultFunction, statusFunction, n)
{
  this.req = req;
  this.resultFunction = resultFunction;
  this.statusFunction = statusFunction;
  this.response_number = n;
}

// callback after receiving data
RemotingProxy.prototype._callBackFunction = function (handle) {
  if (handle.req.readyState == 4) {
    if (handle.req.status == 200) {
        var resp = handle.req.responseText;
        console.log(encodeURIComponent(resp));
        var o = decodeAMF(resp);
        // ErrorClass
        console.log(o.messages);
        handle.resultFunction(o.messages.length?o.messages[0].body:undefined, this);
    } else {
      handle.statusFunction('ERROR: AJAX request status = ' + handle.req.status, this);
    }
  }
}

// 
function FlashCallbackSuccess( str ) {
  try {
    var o = decodeAMF(unescape(str));
  } catch (e) {
      txt = "There was an error on this page.\n\n"
        + "Error description: " + e.description + "\n\n"
        + "Click OK to continue.\n\n";
      alert(txt);
  }
  //handle.resultFunction(o.messages[0].body);;
  return false;
}

// if the flash file has failed to send message, we just ignore it
function FlashCallbackFailure( str ){
  alert(str);
  return false;
}

// once the flash player has loaded, you can now send any buffered messages
// note this may fail under multiple RemotingProxy's
function FlashInterfaceLoaded() {
  var remotingProxy = swfBridgeRemotingProxyList.pop();
  remotingProxy.flashgatewayloaded = true;
  for (var i = 0; i < remotingProxy.flashgatewaybuffer.length; i ++) {
    var b = remotingProxy.flashgatewaybuffer[i];
    remotingProxy.flashgateway.sendData(b[0], b[1]);
  }
  remotingProxy.flashgatewaybuffer = []; //erase buffer
}

// adds a remoting function to this handler
RemotingProxy.prototype.addHandler = function(
  handlestr,
  resultFunction,
  statusFunction)
{
  // create handle function
  this[handlestr] = function () {
    // string to send
    var str = encodeAMF({
      version  : this.encoding,
      headers  : [],
      messages : [{
        targetURL  : this.service + "." + handlestr,
        responseURI: "/" + (this.response_number++),
        body  : Array.prototype.slice.call(arguments)
      }]
    }),
    handle,req;
    this.handles[this.response_number] = this[handlestr];

    if (_window.XMLHttpRequest && "undefined" == typeof(_window.ActiveXObject)) {
      req = new XMLHttpRequest();
      //XHR binary charset opt by Marcus Granado 2006 [http://mgran.blogspot.com]
      req.overrideMimeType("text/plain; charset=x-user-defined");
      req.open("POST", this.url, true);
      req.setRequestHeader("Content-Type", "application/x-amf");
      handle = new RemotingProxy.RequestHandle(req, resultFunction,statusFunction, this.response_number);
      req.onreadystatechange = function () {
        RemotingProxy.prototype._callBackFunction.call(this, handle);
      }.bind(this);
    }

    // the browser must support binary Http requests
    if ("undefined" != typeof(req) && req.sendAsBinary) { // firefox (w3 standard)
      req.sendAsBinary(str);
    } else if (_window.ActiveXObject) {   // IE
      // gateway not ready, buffer the requests
      if (!this.flashgatewayloaded) {
        this.flashgatewaybuffer.push([this.url, escape(str)]);
        return;
      }
      try {
        this.flashgateway.sendData(this.url, escape(str));
      } catch (e) {
        // @TODO have a cry here
        alert('failed to send binary data ' + e.description);
      }
    } else {
      // Safari does not convert binary to string. Let's hope if gets here, so does your browser
      req.send(str);
    }
  }
}

function dumpHex(bytes)
{
  var s = "";
  var i = 0;
  var chunk = [];

  while (i < bytes.length) {

    if (!(i % 16) && i) {
      s += writeChunk(chunk, 16) + "\n";
      chunk = [];
    }

    chunk.push(bytes.readUnsignedByte());

    i++;
  }
  s += writeChunk(chunk, 16);

  bytes.pos = 0;

  return s;
}

function writeChunk(chunk, width)
{
  var s = "";

  for (var i = 0; i < chunk.length; i++)
  {
    if (((i % 4) == 0) && (i != 0))
    {
      s += " ";
    }

    var b = chunk[i];

    var ss = b.toString(16) + " ";
    if (ss.length == 2)
    {
      ss = "0" + ss;
    }

    s += ss;
  }

  for (var i = 0; i < (width - chunk.length); i++)
  {
    s += "   ";
  }

  var j = Math.floor((width - chunk.length) / 4);
  for (var i = 0; i < j; i++)
  {
    s += " ";
  }

  s += "   ";

  for (var i = 0; i < chunk.length; i++)
  {
    var b = chunk[i];

    if ((b <= 126) && (b > 32))
    {
      var ss = String.fromCharCode(b);
      s += ss;
    }
    else
    {
      s += ".";
    }
  }

  return s;
}

// 'static' data definitions
if ('undefined' == typeof(amf))
{
  amf = {
    registeredClasses: {},
    RegisteredClass: function (name, funt) {
      this.name = name;
      this.initFunct = funt;
    }
  };
}







// dynamic objects get made here
function registerClassAlias(VOname, classVO)
{
    if (VOname in amf.registeredClasses) {
        return amf.registeredClasses[VOname];
    }

    console.log("Registering " + VOname + "...");
    return amf.registeredClasses[VOname] = new amf.RegisteredClass(VOname, classVO);
}

// src http://ejohn.org/blog/simple-javascript-inheritance/
(function()
{
  var initializing = false, fnTest = /xyz/.test(function()
  {
    xyz;
  }) ? /\b_super\b/ : /.*/;

  // Base Class implementation
  this.Class = function()
  {
  };

  // Create a new Class that inherits from this class
  Class.extend = function(prop)
  {
    var _super = this.prototype;

    // Instantiate a base class (but only create the instance,
    // don't run the init constructor)
    initializing = true;
    var prototype = new this();
    initializing = false;

    // Copy the properties over onto the new prototype
    for (var name in prop)
    {
      // Check if we're overwriting an existing function
      prototype[name] = typeof prop[name] == "function" &&
      typeof _super[name] == "function" && fnTest.test(prop[name]) ?
      (function(name, fn)
      {
        return function()
        {
          var tmp = this._super;

          // Add a new ._super() method that is the same method
          // but on the super-class
          this._super = _super[name];

          // The method only need to be bound temporarily, so we
          // remove it when we're done executing
          var ret = fn.apply(this, arguments);
          this._super = tmp;

          return ret;
        };
      })(name, prop[name]) :
      prop[name];
    }

    // The dummy class constructor
    function Class()
    {
      // All construction is actually done in the init method
      if (!initializing && this.init)
        this.init.apply(this, arguments);
    }

    // Populate our constructed prototype object
    Class.prototype = prototype;

    // Enforce the constructor to be what we expect
    Class.constructor = Class;

    // And make this class extendable
    Class.extend = arguments.callee;

    return Class;
  };
})();

/**
 * Enum for big or little endian.
 * @enum {number}
 */
amf.Endian = {
  BIG: 0,
  LITTLE: 1,
};

// AMF encoding type
amf.ObjectEncoding = {
  AMF0: 0,
  AMF3: 3,
};

// AMF data types 
amf.Amf0Types = {
  kNumberType:     0,
  kBooleanType:    1,
  kStringType:     2,
  kObjectType:     3,
  kMovieClipType:    4,
  kNullType:       5,
  kUndefinedType:    6,
  kReferenceType:    7,
  kECMAArrayType:    8,
  kObjectEndType:    9,
  kStrictArrayType:   10,
  kDateType:      11,
  kLongStringType:  12,
  kUnsupportedType:   13,
  kRecordsetType:   14,
  kXMLObjectType:   15,
  kTypedObjectType:   16,
  kAvmPlusObjectType: 17,
};

// AMF3 datatypes
amf.Amf3Types = {
  kUndefinedType:  0,
  kNullType:     1,
  kFalseType:    2,
  kTrueType:     3,
  kIntegerType:  4,
  kDoubleType:   5,
  kStringType:   6,
  kXMLType:    7,
  kDateType:     8,
  kArrayType:    9,
  kObjectType:   10,
  kAvmPlusXmlType: 11,
  kByteArrayType:  12,
};

// each AMF message has a target
amf.AMFMessage = Class.extend({
  targetURL: ""
  , responseURI: ""
  , body: {}
  , init: function(targetURL, responseURI, body)
  {
    this.targetURL = targetURL;
    this.responseURI = responseURI;
    this.body = body;
  }
});

amf.AMFPacket = Class.extend({
  version:  0
  , headers: []
  , messages: []
  , init: function(version)
  {
    this.version = (version !== undefined) ? version : 0;
    this.headers = [];
    this.messages = [];
  }
});

amf.AMFHeader = Class.extend({
  name: ""
  , mustUnderstand: false
  , data: {}
  , init: function(name, mustUnderstand, data)
  {
    this.name = name;
    this.mustUnderstand = (mustUnderstand != undefined) ? mustUnderstand : false;
    this.data = data;
  }
});

// AMF 0 objects
function Integer()
{
  this.data = 0;
}

/**
 * Attempt to imitate AS3's ByteArray as very high-performance javascript.
 * I aliased the functions to have shorter names, like ReadUInt32 as well as ReadUnsignedInt.
 * I used some code from http://fhtr.blogspot.com/2009/12/3d-models-and-parsing-binary-data-with.html
 * to kick-start it, but I added optimizations and support both big and little endian.
 * Note that you cannot change the endianness after construction.
 * @extends Class
 */
amf.ByteArray = Class.extend({
  data: []
  , length: 0
  , pos: 0
  , pow: Math.pow
  , endian: amf.Endian.BIG
  , TWOeN23: Math.pow(2, -23)
  , TWOeN52: Math.pow(2, -52)
  , objectEncoding: amf.ObjectEncoding.AMF0
  , stringTable: []
  , objectTable: []
  , traitTable: []
  , string2arrayOfBytes: function (str) {
    return Array.prototype.concat.apply([], str.split("").map(function(c) {
        var n = c.charCodeAt(0);

        if (n <= 0x7F) {
            return n;
        } else if (n <= 0x7FF) {
            return [0xC0 | ((n>>6) & 0x1F), 0x80 | (n & 0x3F)];
        } else if (n <= 0xFFFF) {
            return [0xE0 | ((n>>12) & 0x0F), 0x80 | ((n>>6) & 0x3F), 0x80 | (n & 0x3F)];
        } else if (n <= 0x10FFFF) {
            return [0xF0 | ((n>>18) & 0x07), 0x80 | ((n>>12) & 0x3F), 0x80 | ((n>>6) & 0x3F), 0x80 | (n & 0x3F)];
        } else {
            throw "Error converting char to byte " + n;
        }
    }));
  }

  /** @constructor */
  , init: function(data, endian, encoding)
  {
    if (typeof data == "string") {
      data = this.string2arrayOfBytes(data);

      console.log(data.toSource());
    }

    this.data = (data !== undefined?data:[]);
    this.endian = (endian !== undefined?endian:amf.Endian.BIG);
    this.objectEncoding = (encoding !== undefined?encoding:amf.ObjectEncoding.AMF0);
    this.length = this.data.length;
    this.stringTable = [];
    this.objectTable = [];
    this.traitTable = [];

    // Cache the function pointers based on endianness.
    // This avoids doing an if-statement in every function call.
    var funcExt = (this.endian == amf.Endian.BIG) ? 'BE' : 'LE',
    funcs = ['readUInt16', 'readUInt30', 'readUInt32', 'readInt16', 'readInt32', 'readFloat32', 'readFloat64'];
    for (var func in funcs) {
      this[funcs[func]] = this[funcs[func] + funcExt];
    }

    // Add redundant members that match actionscript for compatibility
    var funcMap = {
      readBoolean: 'readBool',
      readUnsignedByte: 'readByte',
      readUnsignedShort: 'readUInt16' + funcExt,
      readUnsignedInt: 'readUInt32' + funcExt,
      readShort: 'readInt16' + funcExt,
      readInt: 'readInt32' + funcExt,
      readFloat: 'readFloat32' + funcExt,
      readDouble: 'readFloat64' + funcExt,
    };
    for (var func in funcMap)
    {
      this[func] = this[funcMap[func]];
    }
  }
  , readByte: function()
  {
    //return (this.readByteRaw());
    // http://stackoverflow.com/a/2953960/157873

    var uc = 0,
    pos = this.pos,
    c1 = (this.readByteRaw() & 0xFF),
    c2 = (this.data[1 + pos] & 0xFF),
    seqlen = 0;

    function IS_IN_RANGE (c, f, l) {
        return (f <= c && c <= l);
    }

    // http://www.joelonsoftware.com/pictures/unicode/utf8.png
    /*
        00000000 0000007F 0vvvvvvv[0x7F]    [0x3F]
        00000080 000007FF 110vvvvv[0x1F] 10vvvvvv
        00000800 0000FFFF 1110vvvv[0x0F] 10vvvvvv 10vvvvvv
        00010000 001FFFFF 11110vvv[0x07] 10vvvvvv 10vvvvvv 10vvvvvv

        00200000 03FFFFFF 111110vv[0x03] 10vvvvvv 10vvvvvv 10vvvvvv 10vvvvvv
        04000000 7FFFFFFF 1111110v[0x01] 10vvvvvv 10vvvvvv 10vvvvvv 10vvvvvv 10vvvvvv
            A         B          C                 D          E           F        G         H

        0x2019        -> 00100000 00011001
                           0010   000000   011001
        %EF%9F%A2    -> 11101111 10011111 10100010
                    ->     1111   011111   100010
        0xF7E2        ->     1111   011111   100010
            
        %EF%9E%80
        11101111 10011110 10000000    1111 011110 000000
        %EF%9E%99
        11101111 10011110 10011001    1111 011110 011001

        0x2026
        00100000 00100110
        %EF%9F%A2 %EF%9E%80 %EF%9E%A6

    */
    if (0 == (c1 & 0x80)) {
        uc = (c1 & 0x7F);    // C
        seqlen = 1;
    } else if (0xC0 == (c1 & 0xE0)) {
        uc = (c1 & 0x1F);    // C
        seqlen = 2;
    } else if (0xE0 == (c1 & 0xF0)) {
        uc = (c1 & 0x0F);    // C
        seqlen = 3;
    } else if (0xF0 == (c1 & 0xF8)) {
        uc = (c1 & 0x07);    // C
        seqlen = 4;
/*
    } else if (0xF8 == (c1 & 0xFC)) {
        uc = (c1 & 0x03);    // C
        seqlen = 5;
    } else if (0xFC == (c1 & 0xFE)) {
        uc = (c1 & 0x01);    // C
        seqlen = 6;
*/
    } else {
//        console.log(this.data[this.pos-2]);
        throw "Malformed data 0 0x" + (c1).toString(16) + " (" + this.pos + ")";
    }
    
    for (var ai = 1; ai < seqlen; ++ai) {
        if (0x80 != (this.data[ai + pos] & 0xC0)) {    // 10vvvvvv [0x40]
            throw "Malformed data 1 " + ai + "/" + seqlen + " 0x" + (this.data[ai + pos]).toString(16) + " [c1 = 0x" + (c1).toString(16) +"] " + pos;
        }
    }
    
    switch (seqlen) {
        case 2:
            if (!IS_IN_RANGE(c1, 0xC2, 0xDF)) {
                throw "Malformed data 2";
            }
            break;
        case 3:
            if (((c1 == 0xE0) && !IS_IN_RANGE(c2, 0xA0, 0xBF)) ||
                ((c1 == 0xED) && !IS_IN_RANGE(c2, 0x80, 0x9F)) ||
                (!IS_IN_RANGE(c1, 0xE1, 0xEC) && !IS_IN_RANGE(c1, 0xEE, 0xEF))) {
                throw "Malformed data 3";
            }
            break;
        case 4:
            if (((c1 == 0xF0) && !IS_IN_RANGE(c2, 0x90, 0xBF)) ||
                ((c1 == 0xF4) && !IS_IN_RANGE(c2, 0x80, 0x8F)) ||
                !IS_IN_RANGE(c1, 0xF1, 0xF3)) {
                throw "Malformed data 4";
            }
            break;
    }

    for (var ai = 1; ai < seqlen; ++ai) {
        uc = ((uc << 0x06) | (this.readByteRaw() & 0x3F));
    }

    return uc;
  }
  , writeByte: function(value)
  {
    this.data.push(value);
  }
  , readBool: function()
  {
    return (this.readByte() & 0xFF) ? true : false;
  }
  , readUInt30BE: function()
  {
    var ch = [];
    for (var ai = 4;ai;--ai) {
        ch.push(this.readByte() & 0xFF);
    }

    if (ch[0] >= 0x40) {
      return undefined;
    }

    return (ch[0] << 0x18)
        | (ch[1] << 0x10)
        | (ch[2] << 0x08)
        | ch[3];
  }
  , readUInt32BE: function()
  {
    var ch = [];
    for (var ai = 4;ai;--ai) {
        ch.push(this.readByte() & 0xFF);
    }

    return (ch[0] << 0x18)
        | (ch[1] << 0x10)
        | (ch[2] << 0x08)
        | ch[3];
  }
  , readInt32BE: function()
  {
    var x = this.readUInt32BE();

    return (x >= 0x80000000) ? x - 0x100000000 : x;
  }
  , readUInt16BE: function()
  {
    return ((this.readByte() & 0xFF) << 0x08)
      | (this.readByte() & 0xFF);
  }
  , readInt16BE: function()
  {
    var x = this.readUInt16BE();

    return (x >= 0x8000) ? x - 0x10000 : x;
  }
  , readFloat32BE: function()
  {
    var b = [];
    for (var ai = 4;ai;--ai) {
        b.push(this.readByte() & 0xFF);
    }

    var sign = 1 - ((b[0] >> 0x07) << 1),           // sign = bit 0
    exp = (((b[0] << 1) & 0xFF) | (b[1] >> 0x07)) - 0x7F,  // exponent = bits 1..8
    sig = ((b[1] & 0x7F) << 0x10) | (b[2] << 0x08) | b[3];  // significand = bits 9..31

    if (sig == 0 && exp == -0x7F) {
      return 0.0;
    }

    return sign * (1 + this.TWOeN23 * sig) * this.pow(2, exp);
  }
  , readFloat64BE: function() {
    var b = [];
    for (var ai = 8;ai;--ai) {
      b.push(this.readByte() & 0xFF);
    }

    // This crazy toString() stuff works around the fact that js ints are
    // only 32 bits and signed, giving us 31 bits to work with
//  var sig = ("0000000000000000000" + (((b[1] & 0x0F) << 0x10) | (b[2] << 0x08) | b[3]).toString(2)).slice(-20) +
    var sig = (((b[1] & 0x0F) << 0x10) | (b[2] << 0x08) | b[3]).toString(2) +
    ((b[4] >> 0x07) ? "1" : "0") +
    ("000000000000000000000000000000" + (((b[4] & 0x7F) << 0x18) | (b[5] << 0x10) | (b[6] << 0x08) | b[7]).toString(2)).slice(-31),  // significand = bits 12..63
    sign = 1 - ((b[0] >> 0x07) << 1),                // sign = bit 0
    exp = (((b[0] << 0x04) & 0x7FF) | (b[1] >> 0x04)) - 0x3FF;    // exponent = bits 1..11

    sig = parseInt(sig, 2);

    if (sig == 0 && exp == -0x3FF) {
      return 0.0;
    }

    return sign * (1.0 + this.TWOeN52 * sig) * this.pow(2, exp);
  }

  , readUInt29: function()
  {
    // @TODO fix in IE. After reading a byte array, this function sometimes returns the wrong value
    var value = 0,b;

    for (var ai = 3;(b = this.readByte()) >= 0x80 && ai--;) {
      value = (value | (b & 0x7F)) << (7 + !ai);
    }

    return (value | b);
  }

  , readUInt30LE: function()
  {
    var ch = [];
    for (var ai = 4;ai;--ai) {
        ch.push(this.readByte() & 0xFF);
    }

    if (ch[3] >= 0x40) {
      return undefined;
    }

    return ch[0] | (ch[1] << 0x08) | (ch[2] << 0x10) | (ch[3] << 0x18);
  }

  , readUInt32LE: function()
  {
    var ch = [];
    for (var ai = 4;ai;--ai) {
        ch.push(this.readByte() & 0xFF);
    }

    return ch[0]
      | (ch[1] << 0x08)
      | (ch[2] << 0x10)
      | (ch[3] << 0x18);
  }
  , readInt32LE: function()
  {
    var x = this.readUInt32LE();

    return (x >= 0x80000000) ? x - 0x100000000 : x;
  }

  , readUInt16LE: function()
  {
    return (this.readByte() & 0xFF)
      | ((this.readByte() & 0xFF) << 0x08);
  }
  , readInt16LE: function()
  {
    var x = this.readUInt16LE();

    return (x >= 0x8000) ? x - 0x10000 : x;
  }

  , readFloat32LE: function()
  {
    var b = [];
    for (var ai = 4;ai;--ai) {
        b.push(this.readByte() & 0xFF);
    }

    var sign = 1 - ((b[0] >> 0x07) << 1),           // sign = bit 0
    exp = (((b[0] << 1) & 0xFF) | (b[1] >> 0x07)) - 0x7F,  // exponent = bits 1..8
    sig = b[3] | (b[2] << 0x08) | ((b[1] & 0x7F) << 0x10);  // significand = bits 9..31

    if (sig == 0 && exp == -0x7F) {
      return 0.0;
    }

    return sign * (1 + this.TWOeN23 * sig) * this.pow(2, exp);
  }
  , readFloat64LE: function() {
    var b = [];
    for (var ai = 8;ai;--ai) {
      b.push(this.readByte() & 0xFF);
    }

    // This crazy toString() stuff works around the fact that js ints are
    // only 32 bits and signed, giving us 31 bits to work with
//  var sig = ("0000000000000000000" + (((b[1] & 0x0F) << 0x10) | (b[2] << 0x08) | b[3]).toString(2)).slice(-20) +
    var sig = (((b[1] & 0x0F) << 0x10) | (b[2] << 0x08) | b[3]).toString(2) +
    ((b[4] >> 0x07) ? "1" : "0") +
    ("000000000000000000000000000000" + (((b[4] & 0x7F) << 0x18) | (b[5] << 0x10) | (b[6] << 0x08) | b[7]).toString(2)).slice(-31),  // significand = bits 12..63
    sign = 1 - ((b[0] >> 0x07) << 1),                // sign = bit 0
    exp = (((b[0] << 0x04) & 0x7FF) | (b[1] >> 0x04)) - 0x3FF;    // exponent = bits 1..11

    sig = parseInt(sig, 2);

    if (sig == 0 && exp == -0x3FF) {
      return 0.0;
    }

    return sign * (1.0 + this.TWOeN52 * sig) * this.pow(2, exp);
  }

  , readDate: function()
  {
    return new Date(this.readDouble() + 60000 * this.readShort());
  }

  , readString: function(len)
  {
    var str = "";

    for (;len;--len) {
      str += String.fromCharCode(this.readByte());
    }

    return str;
  }
  , readUTF: function ()
  {
    return this.readString(this.readUnsignedShort());
  }
  , readLongUTF: function ()
  {
    return this.readString(this.readUInt30());
  }
  , stringToXML: function(str)
  {
    var xmlDoc;

    if (_window.DOMParser)
    {
      var parser = new DOMParser();
      xmlDoc = parser.parseFromString(str, "text/xml");
    }
    else // IE
    {
      xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
      xmlDoc.async = false;
      xmlDoc.loadXML(stc);
    }

    return xmlDoc;
  }

  , readXML: function ()
  {
    return this.stringToXML(this.readLongUTF());
  }

  , readStringAMF3: function ()
  {
    var ref = this.readUInt29();
    if ((ref & 1) == 0) {// This is a reference
      return this.stringTable[(ref >> 1)];
    }

    var len = (ref >> 1);

    if (0 == len) {
      return "";
    }

    var str = this.readString(len);

    this.stringTable.push(str);

    return str;
  }

  , readTraits: function(ref)
  {
    var traitInfo = {};
    traitInfo.properties = [];

    if ((ref & 3) == 1) {
      return this.traitTable[(ref >> 2)];
    }

    traitInfo.externalizable = ((ref & 4) == 4);
    traitInfo.dynamic = ((ref & 8) == 8);
    traitInfo.count = (ref >> 4);
    traitInfo.className = this.readStringAMF3();

    for (var i = 0; i < traitInfo.count; i++) {
      traitInfo.properties.push(this.readStringAMF3());
    }

    this.traitTable.push(traitInfo);

    return traitInfo;
  }

  , readExternalizable: function(className)
  {
    return this.readObject();
  }

  , readObject: function()
  {
    if (this.objectEncoding == amf.ObjectEncoding.AMF0) {
      return this.readAMF0Object();
    } else if (this.objectEncoding == amf.ObjectEncoding.AMF3) {
      return this.readAMF3Object();
    }
  }
  , readAMF0Object: function()
  {
    var marker = this.readByte();
    switch (marker) {
      case amf.Amf0Types.kUndefinedType:
        return undefined;
      case amf.Amf0Types.kNullType:
        return null;
      case amf.Amf0Types.kBooleanType:
        return this.readBoolean();
      case amf.Amf0Types.kNumberType:
        return this.readDouble();
      case amf.Amf0Types.kStringType:
        return this.readUTF();
      case amf.Amf0Types.kAvmPlusObjectType:
        return this.readAMF3Object();
      case amf.Amf0Types.kReferenceType:
        return this.objectTable[this.readUnsignedShort()];
      case amf.Amf0Types.kDateType:
        return this.readDate();
      case amf.Amf0Types.kLongStringType:
        return this.readLongUTF();
      case amf.Amf0Types.kXMLObjectType:
        return this.readXML();
      case amf.Amf0Types.kObjectType:
      case amf.Amf0Types.kECMAArrayType:
        var o = {},
        ismixed = (marker == amf.Amf0Types.kECMAArrayType);

        if (ismixed) {
          this.readUInt30();
        }

        while (true) {
          var name = this.readUTF();

          if (this.data[this.pos] == amf.Amf0Types.kObjectEndType) {
            this.pos++;
            break;
          }

          o[name] = this.readObject();
        }

        return o;
      case amf.Amf0Types.kStrictArrayType:
        var a = [];

        for (var i = this.readInt();i;--i) {
          a.push(this.readObject());
        }

        return a;
      case amf.Amf0Types.kTypedObjectType:
        var name = this.readUTF(),
        ca = registerClassAlias(name, function () {}),
        o = new ca.initFunct(),
        propertyName = this.readUTF();

        while (this.data[this.pos] != amf.Amf0Types.kObjectEndType) {
          o[propertyName] = this.readObject();

          propertyName = this.readUTF();
        }
        this.pos++;

        return o;
    }

    throw ("AMF0 Decoding failure. ID with type " + marker + " found. (" + this.pos + ")");
  }
  , readAMF3Object: function()
  {
    switch (this.readByte()) {
      case amf.Amf3Types.kUndefinedType:
        return undefined;
      case amf.Amf3Types.kNullType:
        return null;
      case amf.Amf3Types.kFalseType:
        return false;
      case amf.Amf3Types.kTrueType:
        return true;
      case amf.Amf3Types.kIntegerType:
        return this.readUInt29();
      case amf.Amf3Types.kDoubleType:
        return this.readDouble();
      case amf.Amf3Types.kStringType:
        return this.readStringAMF3();
      case amf.Amf3Types.kXMLType:
        return this.readXML();
      case amf.Amf3Types.kDateType:
        var ref = this.readUInt29();

        if ((ref & 1) == 0) {
          return this.objectTable[(ref >> 1)];
        }

        var value = new Date(this.readDouble());
        this.objectTable.push(value);

        return value;
      case amf.Amf3Types.kArrayType:
        var ref = this.readUInt29();

        if ((ref & 1) == 0) {
          return this.objectTable[(ref >> 1)];
        }

        var key = this.readStringAMF3();

        if (key == "") {
          var a = [];
          this.objectTable.push(a); // this was lacking in prev versions

          for (var i = (ref >> 1);i;--i) {
            a.push(this.readObject());
          }

          return a;
        }

        // mixed array
        var result = {};
        this.objectTable.push(result);

        while (key != "") {
          result[key] = this.readObject();
          key = this.readStringAMF3();
        }

        for (var i = 0; i < len; i++) {
          result[i] = this.readObject();
        }

        return result;
      case amf.Amf3Types.kObjectType:
        var ref = this.readUInt29();

        if ((ref & 1) == 0) {
          return this.objectTable[(ref >> 1)];
        }

        var o = {},
        ti = this.readTraits(ref),
        className = ti.className,
        ca = registerClassAlias(className, function () {}),
        o = new ca.initFunct(),
        externalizable = ti.externalizable;

        this.objectTable.push(o);

        if (externalizable) {
          o = this.readExternalizable(className);
        } else {
          var len = ti.properties.length;

          for (var i = 0; i < len; i++) {
            o[ti.properties[i]] = this.readObject();
          }
          if (ti.dynamic) {
            while (true) {
              var name = this.readStringAMF3();
              if (null == name || 0 == name.length) {
                break;
              }
              o[name] = this.readObject();
            }
          }
        }

        return o;
      case amf.Amf3Types.kAvmPlusXmlType:
        var ref = this.readUInt29();

        if ((ref & 1) == 0) {
          return this.stringToXML(this.objectTable[(ref >> 1)]);
        }

        var len = (ref >> 1);

        if (0 == len) {
          return null;
        }


        var xml = this.stringToXML(this.readString(len));

        this.objectTable.push(xml);

        return xml;
      case amf.Amf3Types.kByteArrayType:
        //
        // @TODO write this so it works in IE. there's an error where
        // after reading the byte array, the readUInt29() after reads the
        // wrong byte.
        //
        // small byte arrays don't seem to be affected
        //

        var ref = this.readUInt29();
        if ((ref & 1) == 0) {
          return this.objectTable[(ref >> 1)];
        }

        var len = (ref >> 1),
        ba = new amf.ByteArray([], this.endian, this.objectEncoding);

        this.objectTable.push(ba);

        for (var i = 0; i < len; i++) {
          ba.writeByte(this.readByte());
        }

        return ba;
    }
    alert ('failure in ' + marker);
    throw ("AMF3 Decoding failure. ID with type " + marker + " found.");
  },
  readByteRaw: function()
  {
    return this.data[this.pos++];
  },
  // from http://jsfromhell.com/classes/binary-parser
  writeInt: function(number, bits)
  {
    var max = Math.pow(2, bits),
    r = [];

    if (number >= max || number < -(max >> 1)) {
      number = 0;
    } else if (number < 0) {
      number += max;
    }

    while (number) {
      r.push(number % 0x100);
      number = Math.floor(number / 0x100);
    }
    bits = -(-bits >> 3) - r.length;
    while (bits--) {
      r.push(0);
    }

    Array.prototype.push.apply(this.data, this.endian == amf.Endian.BIG ? r.reverse() : r);
  },
  writeUTF: function (str)
  {
    this.writeInt(str.length, 0x10); // unsigned short (max 65535)

    Array.prototype.push.apply(this.data, str.split("").map(function ($0) {
        return $0.charCodeAt(0);
    }));
  },// fr : http://snippets.dzone.com/posts/show/685
  writeDouble: function(data) {
    data = parseFloat(data);
    var precisionBits = 52;
    var exponentBits = 11;
    var bias = Math.pow( 2, exponentBits - 1 ) - 1, minExp = -bias + 1, maxExp = bias, minUnnormExp = minExp - precisionBits,
    status = isNaN( n = parseFloat( data ) ) || n == -Infinity || n == +Infinity ? n : 0,
    exp = 0, len = 2 * bias + 1 + precisionBits + 3, bin = new Array( len ),
    signal = ( n = status !== 0 ? 0 : n ) < 0, n = Math.abs( n ), intPart = Math.floor( n ), floatPart = n - intPart,
    i, lastBit, rounded, j, result;
    for( i = len; i; bin[--i] = 0 );
    for( i = bias + 2; intPart && i; bin[--i] = intPart % 2, intPart = Math.floor( intPart / 2 ) );
    for( i = bias + 1; floatPart > 0 && i; ( bin[++i] = ( ( floatPart *= 2 ) >= 1 ) - 0 ) && --floatPart );
    for( i = -1; ++i < len && !bin[i]; );
    if( bin[( lastBit = precisionBits - 1 + ( i = ( exp = bias + 1 - i ) >= minExp && exp <= maxExp ? i + 1 : bias + 1 - ( exp = minExp - 1 ) ) ) + 1] ){
      if( !( rounded = bin[lastBit] ) )
        for( j = lastBit + 2; !rounded && j < len; rounded = bin[j++] );
      for( j = lastBit + 1; rounded && --j >= 0; ( bin[j] = !bin[j] - 0 ) && ( rounded = 0 ) );
    }
    for( i = i - 2 < 0 ? -1 : i - 3; ++i < len && !bin[i]; );
    if( ( exp = bias + 1 - i ) >= minExp && exp <= maxExp )
      ++i;
    else if( exp < minExp ){
      //console.log(exp != bias + 1 - len && exp < minUnnormExp);
      i = bias + 1 - ( exp = minExp - 1 );
    }
    if( intPart || status !== 0 ){
      //console.log( intPart ? "encodeFloat::float overflow" : "encodeFloat::" + status );
      exp = maxExp + 1;
      i = bias + 2;
      if( status == -Infinity )
        signal = 1;
      else if( isNaN( status ) )
        bin[i] = 1;
    }
    for( n = Math.abs( exp + bias ), j = exponentBits + 1, result = ""; --j; result = ( n % 2 ) + result, n = n >>= 1 );
    for( n = 0, j = 0, i = ( result = ( signal ? "1" : "0" ) + result + bin.slice( i, i + precisionBits ).join( "" ) ).length, r = []; i; j = ( j + 1 ) % 8 ){
      n += ( 1 << j ) * result.charAt( --i );
      if( j == 7 ){
        r.push(n);
        n = 0;
      }
    }
    if (n) {
        r.push(n);
    }

    Array.prototype.push.apply(this.data, this.endian == amf.Endian.BIG ? r.reverse() : r);
  },
  writeAMF0Array: function (array)
  {
    // Strict Array Type
    this.writeInt(amf.Amf0Types.kStrictArrayType, 8);
    this.writeInt(array.length, 32);

    for (var ai = 0;ai < array.length;++ai) {
      this.writeObject(array[ai]);
    }
  },
  writeObject : function (d)
  {
    // console.log("writeObject type " + typeof(d) + " (" + d + ")");
    // todo: test this shit
    if (d == undefined){
      this.writeInt(amf.Amf0Types.kAvmPlusObjectType, 8);  // isso é mesmo necessário? Não seria o caso de ter um byte após a linha abaixo?
      this.writeInt(amf.Amf3Types.kUndefinedType, 8);
    }else if (d === false) {
      this.writeInt(amf.Amf0Types.kBooleanType, 8);
      this.writeInt(0, 8);
    }else if (d === true) {
      this.writeInt(amf.Amf0Types.kBooleanType, 8);
      this.writeInt(1, 8);
      // Integer data type is a AMF3 thing
    } else if (d instanceof Integer) {
      this.writeInt(amf.Amf0Types.kAvmPlusObjectType, 8);
      this.writeAMFInt(d.data);
    }else if (typeof(d) == "number" || d == Number.NaN) {
      this.writeInt(amf.Amf0Types.kNumberType, 8);
      this.writeDouble(d); // double
    } else if (d instanceof String || typeof(d) == 'string') {
      this.writeAMF0String(d);
    } else if (d instanceof Array) {
      this.writeAMF0Array(d);
    } else if (d instanceof Object) {
      // writeTypedObject
      var typedObject = false;
      for each (var o in amf.registeredClasses) {
        if (d instanceof o.initFunct) {
          typedObject = true;
          this.writeInt(amf.Amf0Types.kTypedObjectType, 8);
          this.writeUTF(o.name);

          for (var prop in d) {
            this.writeUTF(prop);
            this.writeObject(d[prop]);
          }
          this.writeUTF("");
          this.writeByte(amf.Amf0Types.kObjectEndType);
        }
      }

      // writeAnonymousObject
      if (!typedObject) {
        console.log('class not registered, write');
        console.log(d);
        // if it's a function starting with _, we skip it
        if (typeof(d) == 'function') {
          console.log(d.toString());
          var functionname = d.toString().match(/^function\s(\w+)/);
          console.log("functionname = " + functionname);
        }
        this.writeInt(amf.Amf0Types.kObjectType, 8);
        for (var prop in d) {
          this.writeUTF(prop);
          this.writeObject(d[prop]);
          console.log("write object var " + prop  + " = " + d[prop]);
        }
        this.writeUTF("");
        this.writeByte(amf.Amf0Types.kObjectEndType);
      }
    } else {
      console.log('can\'t write type ' + typeof(d));
    }
  },
  writeAMFInt: function(d)
  {
    //check valid range for 29bits
    if (d >= 0xF0000000 && d <= 0x0FFFFFFF) {
      this.writeInt(amf.Amf3Types.kIntegerType, 8);
      this.writeUInt29(d & 0x1FFFFFFF); // Mask is 2^29 - 1
    } else {
      //overflow condition would occur upon int conversion
      this.writeInt(amf.Amf3Types.kDoubleType, 8);
      this.writeDouble(d);
    }
  },
  writeUInt29: function (ref) {
    if (ref < 0x80) {
      this.writeByte(ref);
    } else if (ref < 0x4000) {
      this.writeByte(((ref >> 7) & 0x7F) | 0x80);
      this.writeByte(ref & 0x7F);
    } else if (ref < 0x200000) {
      this.writeByte(((ref >> 14) & 0x7F) | 0x80);
      this.writeByte(((ref >> 7) & 0x7F) | 0x80);
      this.writeByte(ref & 0x7F);
    } else if (ref < 0x40000000) {
      this.writeByte(((ref >> 22) & 0x7F) | 0x80);
      this.writeByte(((ref >> 15) & 0x7F) | 0x80);
      this.writeByte(((ref >> 8) & 0x7F) | 0x80);
      this.writeByte(ref & 0xFF);
    } else {
      throw ("Integer out of range: " + ref);
    }
  },
  writeAMF0String: function (d)
  {
    this.writeInt(amf.Amf0Types.kStringType, 8);
    //var data = this.string2arrayOfBytes(d);
    var data = Array.prototype.concat.apply([], d.split("").map(function(c) {
        return c.charCodeAt(0);
    }));

    this.writeInt(data.length, 16);
    
    Array.prototype.push.apply(this.data, data);
  },
  writeAMF3String: function (d)
  {
    if ("" == d) {
       //Write 0x01 to specify the empty ctring
      this.data.push(0x01);
    } else if (d in this.stringTable) {
        // search for reused strings
        for (var i = 0; i < this.stringTable.length; i++) {
          if (this.stringTable[i] == d) {
            this.writeInt29(i << 1);
  
            return i;
          }
  
          throw ("failed to find amf3 string");
        }
      } else {
        //var data = this.string2arrayOfBytes(d);
        var data = Array.prototype.concat.apply([], d.split("").map(function(c) {
            return c.charCodeAt(0);
        }));
        this.writeInt29(1 + 2 * data.length);
        Array.prototype.push.apply(this.data, data);
  
        return this.stringTable.push(d);
      }
  },
  hexTob64: function (hex)
  {
    if(!hex) return "";
    var b64array = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var outstr = "";

    // every three hex numbers, encode four Base64 characters
    for ( i = 0; i < hex.length; i+=3) {
      var c1 = hex.charCodeAt(i) & 0xFF,
      c2 = hex.charCodeAt(i+1) & 0xFF,
      c3 = hex.charCodeAt(i+2) & 0xFF;

      outstr += b64array.charAt((c1 >> 2) & 63)
        + b64array.charAt((((c1 << 4) & 48) + ((c2 & 240) >> 4)) & 63)
        + ((hex.length <= i+1) ? '=' : b64array.charAt((((c2 << 2) & 60) + ((c3 >> 6) & 3)) & 63))
        + ((hex.length <= i+2) ? '=' : b64array.charAt(c3 & 63));
    }

    return outstr;
  },
  writeInt29:function (i) {
    i = parseInt(i) & 0x1fffffff;
    if (i < 0x80) {
      this.data.push(i);
    } else if (i < 0x4000) {
      this.data.push((i >> 7 & 0x7f | 0x80)
        + (i & 0x7f));
    } else if (i < 0x200000) {
      this.data.push((i >> 14 & 0x7f | 0x80)
        + (i >> 7 & 0x7f | 0x80)
        + (i & 0x7f));
    } else {
      this.data.push((i >> 22 & 0x7f | 0x80)
        + (i >> 15 & 0x7f | 0x80)
        + (i >> 8 & 0x7f | 0x80)
        + (i & 0xff));
    }
  },
});
