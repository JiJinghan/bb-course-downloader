import {parsePage} from './parser.mjs';
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || message.target!=='parser') return;
  try {respond({ok:true,result:parsePage(message.html,message.url,message.courseId)});}catch(error){respond({ok:false,error:error.message});}
});
