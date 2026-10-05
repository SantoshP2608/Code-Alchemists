#include <bits/stdc++.h>
using namespace std;

int precedence(const string& op){
    if(op == "u+" || op == "u-"){
        return 3;
    } 
    if(op == "*" || op == "/"){
        return 2;
    } 
    if(op == "+" || op == "-"){
        return 1;
    } 
    return 0;
}

vector<string> toPostfix(const string&expression){
    stack<string> operators;
    vector<string> postfix;
    bool expectOperand = true;

    for (int i= 0; i<expression.size();) {
        char ch = expression[i];

        
        if(isdigit(static_cast<unsigned char>(ch))||ch=='.'){
            if(!expectOperand) throw runtime_error("Missing operator");

            size_t used = 0;
            stod(expression.substr(i), &used);
            postfix.push_back(expression.substr(i, used));
            i += used;
            expectOperand = false;
        }
        else if(ch == '('){
            if(!expectOperand) throw runtime_error("Missing operator before '('");

            operators.push("(");
            ++i;
        }
        else if(ch== ')'){
            if(expectOperand) throw runtime_error("Missing operand before ')'");

            while(!operators.empty()&&operators.top()!="("){
                postfix.push_back(operators.top());
                operators.pop();
            }

            if(operators.empty()) throw runtime_error("Mismatched parentheses");

            operators.pop();
            ++i;
            expectOperand = false;
        }
        else if(ch =='+' || ch=='-' || ch=='*' || ch == '/'){
            string op;
            op = ch;

            if(expectOperand){
                if(ch!='+' && ch!='-') throw runtime_error("Missing operand");
                operators.push("u" + op);
            }
            else{
                while(!operators.empty() && operators.top()!="(" && precedence(operators.top())>=precedence(op)){
                    postfix.push_back(operators.top());
                    operators.pop();
                }

                operators.push(op);
                expectOperand = true;
            }
            ++i;
        }
        
    }

    if(expectOperand) throw runtime_error("Empty or incomplete expression");

    while(!operators.empty()){
        if(operators.top() == "(") throw runtime_error("Mismatched parentheses");

        postfix.push_back(operators.top());
        operators.pop();
    }

    return postfix;
}

double evaluatePostfix(const vector<string>& postfix){
    stack<double> values;

    for(auto token : postfix){
        if(token == "u+" || token == "u-"){
            if(values.empty()) throw runtime_error("Invalid expression");

            double value = values.top();
            values.pop();
            if(token=="u-"){
                values.push(-value);
            }
            else{
                values.push(value);
            }
            
        }
        else if(token=="+" || token=="-" || token=="*" || token=="/"){
            if(values.size()<2) throw runtime_error("Invalid expression");

            double right= values.top();
            values.pop();
            double left = values.top();
            values.pop();
            if(token == "+"){
                values.push(left+right);
            }
            else if(token == "-"){
                values.push(left-right);
            }
            else if(token == "*"){
                values.push(left*right);
            }
            else{
                if(right==0){
                    throw runtime_error("Division by zero");
                }
                values.push(left/right);
            }
        }
        else{
            values.push(stod(token));
        }
    }

    if(values.size() != 1) throw runtime_error("Invalid expression");

    return values.top();
}

int main() {
    string expression;
    getline(cin, expression);
    expression.pop_back();
    try{
        vector<string> postfix = toPostfix(expression);
        double result = evaluatePostfix(postfix);
        cout<<"Postfix: ";
        for(auto token : postfix){
            cout<<token<<' ';
            
        }

        cout<<"\nResult: "<<result<<'\n';
    }
    catch(const exception& error){
        cout<<"Error: "<<error.what()<<'\n';
    }

    return 0;
}