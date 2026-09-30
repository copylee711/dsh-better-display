# 单链表（Singly Linked List）

## 一、为什么要用它

顺序表（数组）的痛点很统一：**插入/删除要搬元素，容量要预先确定**。单链表用「指针串起来的一串结点」换掉了这两件事：

- 逻辑上相邻的元素，物理上**不一定相邻**；
- 插删只需改指针，**O(1)**（前提是已找到前驱）；
- 长度按需增长，**不用预估容量**。

代价是：**失去了随机访问**，想找第 i 个必须从头一个个走，O(n)。

---

## 二、结点的定义

```c
typedef int ElemType;

typedef struct LNode {
    ElemType      data;   // 数据域
    struct LNode *next;   // 指针域：指向下一个结点
} LNode, *LinkList;       // LinkList 是指向结点的指针类型
```

一个结点 = 数据域 + 指针域。链表的**结束标志是 next == NULL**。

---

## 三、三个必须分清的名词

```
头指针 L        头结点(哑结点)      首元结点          第二个结点
  │            ┌────┬────┐      ┌────┬────┐     ┌────┬────┐
  └───────────▶│ —  │ ●──┼─────▶│ a1 │ ●──┼────▶│ a2 │ ●──┼───▶ NULL
               └────┴────┘      └────┴────┘     └────┴────┘
```

| 名词 | 含义 |
|---|---|
| **头指针** `L` | 指向链表第一个结点的指针，**永远存在**（空表也不能为 NULL 丢失） |
| **头结点** | 附设在首元结点之前的**哑结点**，`data` 一般不用，`next` 指向首元结点 |
| **首元结点** | 真正存放第一个数据元素 a₁ 的结点 |

**为什么要头结点？** 它把「在第一个位置插入/删除」和「在中间位置插入/删除」的操作**统一**了——都是"改前驱的 next"，不用特判头指针。这是严蔚敏教材默认的风格，也是考试默认写法。

空表（带头结点）：`L->next == NULL`，而不是 `L == NULL`。

---

## 四、基本操作（带头结点版）

### 1. 初始化

```c
bool InitList(LinkList *L) {          // 教材里常写成 InitList(LinkList &L)
    *L = (LNode *)malloc(sizeof(LNode));
    if (*L == NULL) return false;     // 分配失败
    (*L)->next = NULL;                // 空表
    return true;
}
```

### 2. 按位查找：返回第 i 个结点

```c
LNode *GetElem(LinkList L, int i) {
    if (i < 0) return NULL;
    LNode *p = L;              // 从"第 0 个"头结点开始
    int j = 0;
    while (p != NULL && j < i) {
        p = p->next;
        j++;
    }
    return p;                  // i 超长时自然返回 NULL
}
```

**平均时间复杂度 O(n)**。注意 `j` 从 0 起算，这样第 0 个就是头结点，写删除代码时很顺。

### 3. 插入：在第 i 个位置插入 e

```c
bool ListInsert(LinkList L, int i, ElemType e) {
    if (i < 1) return false;
    LNode *p = L;              // 找第 i-1 个（前驱）
    int j = 0;
    while (p != NULL && j < i - 1) { p = p->next; j++; }
    if (p == NULL) return false;               // i 超出表长+1

    LNode *s = (LNode *)malloc(sizeof(LNode));
    if (s == NULL) return false;
    s->data = e;
    s->next = p->next;   // ① 新结点先接住后面
    p->next = s;         // ② 再让前驱指向新结点
    return true;
}
```

> ⚠️ **顺序绝不能反**。先执行 `p->next = s` 的话，原来 p 后面的整条链就再也找不到了——经典的"断链"错误。

### 4. 删除：删掉第 i 个，用 e 带出

```c
bool ListDelete(LinkList L, int i, ElemType *e) {
    if (i < 1) return false;
    LNode *p = L;
    int j = 0;
    while (p != NULL && j < i - 1) { p = p->next; j++; }
    if (p == NULL || p->next == NULL) return false;  // 前驱不存在 或 第 i 个不存在

    LNode *q = p->next;    // q 是被删结点
    *e = q->data;
    p->next = q->next;     // 跨过 q
    free(q);               // 释放内存
    return true;
}
```

循环里的 `p == NULL` 和 `p->next == NULL` 这两个判断缺一不可，分别对应"i 太大"和"i 恰好等于表长+1"。

### 5. 建表：头插法 vs 尾插法

```c
// 头插法：每次插在头结点之后 —— 得到的是【逆序】
void CreateList_Head(LinkList L, int n) {
    L->next = NULL;
    for (int i = 0; i < n; i++) {
        LNode *s = (LNode *)malloc(sizeof(LNode));
        scanf("%d", &s->data);
        s->next = L->next;
        L->next = s;
    }
}

// 尾插法：用尾指针 r 一直跟在最后 —— 得到的是【正序】
void CreateList_Tail(LinkList L, int n) {
    LNode *r = L;                    // r 为尾指针，初始指向头结点
    for (int i = 0; i < n; i++) {
        LNode *s = (LNode *)malloc(sizeof(LNode));
        scanf("%d", &s->data);
        r->next = s;
        r = s;
    }
    r->next = NULL;                  // 别忘了收尾置空
}
```

**考试高频**：给一个序列，问头插法建出来的表是什么样 → 直接倒过来写即可。

### 6. 遍历 / 求表长 / 按值查找

```c
int ListLength(LinkList L) {
    int len = 0;
    for (LNode *p = L->next; p != NULL; p = p->next) len++;
    return len;
}

LNode *LocateElem(LinkList L, ElemType e) {
    LNode *p = L->next;
    while (p != NULL && p->data != e) p = p->next;
    return p;                        // 找不到返回 NULL
}
```

### 7. 销毁（整表释放）

```c
void DestroyList(LinkList L) {
    LNode *p = L->next, *q;
    while (p != NULL) {
        q = p->next;    // 先存下一个
        free(p);        // 再释放当前
        p = q;
    }
    free(L);            // 头结点也释放
}
```

---

## 五、复杂度与顺序表对比

| 操作 | 单链表 | 顺序表 |
|---|---|---|
| 按位查找 `GetElem(i)` | **O(n)** | **O(1)** |
| 按值查找 | O(n) | O(n)（有序可 O(log n)） |
| 插入/删除（**已给前驱指针**） | **O(1)** | O(n) |
| 插入/删除（按下标 i） | O(n)（找前驱） | O(n)（搬元素） |
| 存储密度 | 低（每结点多一个指针） | 高（≈100%） |
| 容量 | 动态，按需 malloc | 需预估/扩容 |

一句话总结：**查得多用顺序表，插删频繁用链表。**

---

## 六、经典技巧：双指针（快慢指针）

这是单链表最值钱的部分，几乎每年都考。

```c
// ① 找中间结点：慢指针走 1 步，快指针走 2 步
LNode *FindMid(LinkList L) {
    LNode *slow = L->next, *fast = L->next;
    while (fast != NULL && fast->next != NULL) {
        slow = slow->next;
        fast = fast->next->next;
    }
    return slow;                 // 偶数个结点时返回中间偏右的那个
}

// ② 判断是否有环（Floyd 判圈）：有环必相遇
bool HasCycle(LinkList L) {
    LNode *slow = L->next, *fast = L->next;
    while (fast != NULL && fast->next != NULL) {
        slow = slow->next;
        fast = fast->next->next;
        if (slow == fast) return true;
    }
    return false;
}

// ③ 找倒数第 k 个：fast 先走 k 步，然后两个一起走
LNode *FindKthFromEnd(LinkList L, int k) {
    LNode *fast = L->next, *slow = L->next;
    int i = 0;
    while (i < k && fast != NULL) { fast = fast->next; i++; }
    if (i < k) return NULL;                  // 表长不足 k
    while (fast != NULL) { slow = slow->next; fast = fast->next; }
    return slow;
}

// ④ 原地反转（头插法思想，O(n) 时间 O(1) 空间）
LinkList Reverse(LinkList L) {
    LNode *p = L->next, *q;
    L->next = NULL;                          // 把原链"摘下来"重新头插
    while (p != NULL) {
        q = p->next;                         // 存后面
        p->next = L->next;                   // 头插
        L->next = p;
        p = q;
    }
    return L;
}
```

---

## 七、高频易错点清单

1. **插入顺序写反** → 断链，后半段内存泄漏。
2. **`free(q)` 之后还访问 `q->data` / `q->next`** → 野指针（所以先取值、先存 next）。
3. **循环条件混淆**：
   - `while (p != NULL)` → 允许 i 到 **表长+1**（插入到末尾）；
   - `while (p->next != NULL)` → 只到 **表长**（用于删除等需要前驱存在的场景）。
4. **头指针和头结点搞混**：头指针是变量，头结点是那块 malloc 出来的内存；空表是 `L->next == NULL`。
5. **不带头结点时的特判**：插入/删除第 1 个位置必须修改头指针本身，所以函数参数要传 `LinkList *L`，否则改动出不了函数。
6. **忘记 malloc 判空**，以及尾插法最后忘记 `r->next = NULL`（多出一个垃圾结点，遍历时暴走）。
7. **不带头结点时表长为 0**：此时 `L == NULL`，任何 `L->next` 都是崩。

---

## 八、横向定位

- **单链表**：只能单向走，找前驱 O(n)；
- **双向链表**：多一个 `prior`，找前驱 O(1)，代价是每结点再多一个指针、插删要改 4 个指针；
- **循环链表**：尾结点 `next` 指回头结点，从任意结点都能绕一圈，判尾条件是 `p->next == L`；
- **静态链表**：用数组模拟指针（游标），适用于不支持指针的语言或需要预分配的场景。

需要的话我可以接着给你**带头结点 vs 不带头结点两版完整代码对照**，或者出一组单链表的练习题带答案。