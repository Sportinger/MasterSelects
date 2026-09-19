using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class BetaDesktop {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback f, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h,Callback f,IntPtr p);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder t,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder t,int n);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern uint SendInput(uint count,Input[] inputs,int size);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int l,t,r,b; }
 [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
 [StructLayout(LayoutKind.Sequential)] struct GuiInfo {public uint size,flags;public IntPtr active,focus,capture,menuOwner,moveSize,caret;public Rect caretRect;}
 [StructLayout(LayoutKind.Sequential)] struct Keyboard {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit,Size=32)] struct Union {[FieldOffset(0)]public Keyboard keyboard;}
 [StructLayout(LayoutKind.Sequential)] struct Input {public uint type;public Union data;}
 public static void Init(){SetProcessDPIAware();}
 public static void Activate(long h){
  if(GetForegroundWindow()==(IntPtr)h)return;
  Rect r;if(!GetWindowRect((IntPtr)h,out r))throw new Exception("Owned window missing");
  if(!SetWindowPos((IntPtr)h,new IntPtr(-1),0,0,0,0,0x13))throw new Exception("Window activation failed: "+Marshal.GetLastWin32Error());
  try {
   var point=new Point{x=r.l+Math.Min(200,(r.r-r.l)/2),y=r.t+15};var end=DateTime.UtcNow.AddSeconds(10);
   while(GetAncestor(WindowFromPoint(point),2)!=(IntPtr)h&&DateTime.UtcNow<end)System.Threading.Thread.Sleep(100);
   if(GetAncestor(WindowFromPoint(point),2)!=(IntPtr)h)throw new Exception("Owned dialog is obscured; activation stopped (expected "+h+", hit "+WindowFromPoint(point).ToInt64()+", root "+GetAncestor(WindowFromPoint(point),2).ToInt64()+")");
   ClickAt(point.x,point.y);RequireFocus(h);
  }finally{SetWindowPos((IntPtr)h,new IntPtr(-2),0,0,0,0,0x13);}
 }
 public static long[] Windows(int[] owners){var list=new List<long>();EnumWindows((h,p)=>{uint pid;GetWindowThreadProcessId(h,out pid);if(Array.IndexOf(owners,(int)pid)>=0&&IsWindowVisible(h))list.Add(h.ToInt64());return true;},IntPtr.Zero);return list.ToArray();}
 public static string Class(long h){var s=new StringBuilder(128);GetClassName((IntPtr)h,s,128);return s.ToString();}
 public static string Title(long h){var s=new StringBuilder(512);GetWindowText((IntPtr)h,s,512);return s.ToString();}
 public static long Control(long parent,int id){long result=0;EnumChildWindows((IntPtr)parent,(h,p)=>{if(GetDlgCtrlID(h)==id&&IsWindowVisible(h))result=h.ToInt64();return true;},IntPtr.Zero);return result;}
 public static long FocusedControl(long window){uint pid;var thread=GetWindowThreadProcessId((IntPtr)window,out pid);var info=new GuiInfo{size=(uint)Marshal.SizeOf(typeof(GuiInfo))};return GetGUIThreadInfo(thread,ref info)?info.focus.ToInt64():0;}
 public static void Click(long h){Rect r;if(h==0||!GetWindowRect((IntPtr)h,out r))throw new Exception("Control missing");ClickAt((r.l+r.r)/2,(r.t+r.b)/2);}
 public static void ClickAt(int x,int y){SetCursorPos(x,y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);}
 public static void ClickOwnedAt(int[] owners,int x,int y){uint pid;GetWindowThreadProcessId(WindowFromPoint(new Point{x=x,y=y}),out pid);if(Array.IndexOf(owners,(int)pid)<0)throw new Exception("Owned control is obscured; click stopped");ClickAt(x,y);}
 public static void RequireFocus(long h){var end=DateTime.UtcNow.AddSeconds(2);while(GetForegroundWindow()!=(IntPtr)h&&DateTime.UtcNow<end)System.Threading.Thread.Sleep(25);if(GetForegroundWindow()!=(IntPtr)h)throw new Exception("Desktop focus changed; input stopped (expected "+h+", actual "+GetForegroundWindow().ToInt64()+")");}
 public static void Key(byte key){keybd_event(key,0,0,UIntPtr.Zero);keybd_event(key,0,2,UIntPtr.Zero);}
 public static void Chord(byte modifier,byte key){keybd_event(modifier,0,0,UIntPtr.Zero);Key(key);keybd_event(modifier,0,2,UIntPtr.Zero);}
 public static void Text(string text){foreach(char c in text){var down=new Input{type=1,data=new Union{keyboard=new Keyboard{scan=c,flags=4}}};var up=new Input{type=1,data=new Union{keyboard=new Keyboard{scan=c,flags=6}}};if(SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(Input)))!=2)throw new Exception("Native text input rejected");}}
}
