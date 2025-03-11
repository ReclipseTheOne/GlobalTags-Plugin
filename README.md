# GlobalTags plugin for [Vencord](https://github.com/Vendicated/Vencord)
A message tag system based on a backend server written in Python.

Host your own GlobalTags server: [GlobalTags-Server](https://github.com/ReclipseTheOne/GlobalTags-Server) <br>
If you wish to test the plugin with a server hosted locally you will need a proxy to bypass CORS: [Proxy](https://github.com/ReclipseTheOne/GlobalTags-Proxy)

Currently it's also bundled with Ollama prompt generation to test a few more APIs, it will most likely be removed before pushing to Vencord.

## Usage:

```
/globaltags create <tag_name> <tag_message> - Create and push a tag to the server
/globaltags delete <tag_name> - The tag needs to be created by you to be able to delete it
/globaltags list <userId> - Show all the tags created by an user
/globaltags who <tag_name> - Show the user that owns a tag
/globaltags settings <fields...> - Edit every plugin field directly in chat (everything is private, no message is sent)

/gt <tag_name> - Send a tag

/globaltags prompt <prompt> <send> - <send> is an optional bool, if set to True it will send the prompt directly into chat, if not it will show as a Clyde message. Defaults to False.
```

## Disclaimer:
<b>The plugin needs a server backend to run but currently there's no default server to fallback to and it needs to be self hosted <3</b>
